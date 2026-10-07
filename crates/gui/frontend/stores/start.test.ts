import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { addToSet, removeFromSet, rescanSet, type SetView, type SourceView } from "@/ipc/set";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { useStartStore } from "@/stores/start";

vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn() }));

const mockedAdd = addToSet as Mock;
const mockedRemove = removeFromSet as Mock;
const mockedRescan = rescanSet as Mock;

const folder = (path: string, overrides: Partial<SourceView> = {}): SourceView => ({
    path,
    name: path.split("/").at(-1) ?? path,
    location: path,
    kind: "folder",
    count: 0,
    size: 0,
    unreadable: false,
    pending: false,
    ...overrides,
});

const view = (revision: number, sources: SourceView[], total = 0): SetView => ({ revision, sources, total });

/** A promise the test resolves when it chooses, to order responses. */
const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

const state = () => useStartStore.getState();

describe("useStartStore", () => {
    beforeEach(() => {
        localStorage.clear();
        // Settings first: resetting them afterwards would reach the start store through its subscription.
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useStartStore.setState(useStartStore.getInitialState(), true);
    });

    it("starts with subfolders not scanned and an empty set", () => {
        expect(state().scanSubfolders).toBe(false);
        expect(state().sources).toEqual([]);
        expect(state().view.total).toBe(0);
    });

    it("shows added paths as pending at once, then Rust's view", async () => {
        const response = deferred<SetView>();
        mockedAdd.mockReturnValue(response.promise);

        const adding = state().add(["/Pictures/Holiday 2025", "C:\\Users\\me\\clip.mp4"]);

        expect(state().sources).toEqual([
            { path: "/Pictures/Holiday 2025", name: "Holiday 2025", pending: true },
            { path: "C:\\Users\\me\\clip.mp4", name: "clip.mp4", pending: true },
        ]);
        expect(mockedAdd).toHaveBeenCalledExactlyOnceWith(["/Pictures/Holiday 2025", "C:\\Users\\me\\clip.mp4"], false);

        response.resolve(view(2, [folder("/Pictures/Holiday 2025", { count: 48 })], 48));
        await adding;

        expect(state().sources).toEqual([folder("/Pictures/Holiday 2025", { count: 48 })]);
        expect(state().view.total).toBe(48);
    });

    it("drops the pending rows of paths Rust skipped", async () => {
        mockedAdd.mockResolvedValue(view(0, []));

        await state().add(["/notes.txt"]);

        expect(state().sources).toEqual([]);
    });

    it("drops the pending rows of a failed add", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockedAdd.mockRejectedValue(new Error("boom"));

        await state().add(["/a"]);

        expect(state().sources).toEqual([]);
    });

    it("ignores a view older than the one shown", async () => {
        const slow = deferred<SetView>();
        mockedAdd.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(view(3, [folder("/a"), folder("/b")]));

        const first = state().add(["/a"]);
        await state().add(["/b"]);
        slow.resolve(view(2, [folder("/a")]));
        await first;

        expect(state().sources.map((row) => row.path)).toEqual(["/a", "/b"]);
    });

    it("applies a slow add's view after a quicker remove's", async () => {
        mockedAdd.mockResolvedValueOnce(view(1, [folder("/b")], 1));
        await state().add(["/b"]);

        // The add starts first, the remove answers first, and the add's listing commits after the removal.
        const slow = deferred<SetView>();
        mockedAdd.mockReturnValueOnce(slow.promise);
        mockedRemove.mockResolvedValueOnce(view(3, [folder("/a", { pending: true })]));
        const adding = state().add(["/a"]);
        await state().remove("/b");
        expect(state().sources).toEqual([folder("/a", { pending: true })]);

        slow.resolve(view(4, [folder("/a", { count: 10 })], 10));
        await adding;

        expect(state().sources).toEqual([folder("/a", { count: 10 })]);
        expect(state().view.total).toBe(10);
    });

    it("removes a source", async () => {
        mockedAdd.mockResolvedValueOnce(view(1, [folder("/a")]));
        await state().add(["/a"]);
        mockedRemove.mockResolvedValueOnce(view(2, []));

        await state().remove("/a");

        expect(mockedRemove).toHaveBeenCalledExactlyOnceWith("/a");
        expect(state().sources).toEqual([]);
    });

    it("toggles scanning subfolders and rescans with the new setting", async () => {
        mockedRescan.mockResolvedValueOnce(view(1, [folder("/a", { count: 5 })], 5));

        await state().toggleScanSubfolders();

        expect(state().scanSubfolders).toBe(true);
        expect(mockedRescan).toHaveBeenCalledExactlyOnceWith(true);
        expect(state().view.total).toBe(5);

        mockedRescan.mockResolvedValueOnce(view(2, [folder("/a", { count: 25 })], 25));
        await state().toggleScanSubfolders();

        expect(state().scanSubfolders).toBe(false);
        expect(mockedRescan).toHaveBeenLastCalledWith(false);
        expect(state().view.total).toBe(25);
    });

    it("shows every folder as being counted until the rescan answers", async () => {
        mockedAdd.mockResolvedValueOnce(
            view(1, [folder("/a", { count: 25 }), folder("/b.png", { kind: "image" })], 26),
        );
        await state().add(["/a", "/b.png"]);

        const rescan = deferred<SetView>();
        mockedRescan.mockReturnValueOnce(rescan.promise);
        const toggling = state().toggleScanSubfolders();

        expect(state().sources.map((row) => row.pending)).toEqual([true, false]);

        rescan.resolve(view(3, [folder("/a", { count: 5 }), folder("/b.png", { kind: "image" })], 6));
        await toggling;

        expect(state().sources.map((row) => row.pending)).toEqual([false, false]);
        expect(state().view.total).toBe(6);
    });

    it("keeps folders counted while a rescan runs, even when an older view arrives", async () => {
        const slowAdd = deferred<SetView>();
        mockedAdd.mockReturnValueOnce(slowAdd.promise);
        const adding = state().add(["/a"]);

        const rescan = deferred<SetView>();
        mockedRescan.mockReturnValueOnce(rescan.promise);
        const toggling = state().toggleScanSubfolders();

        // The add's view was taken before the rescan started, so it still shows the recursive count.
        slowAdd.resolve(view(2, [folder("/a", { count: 25 })], 25));
        await adding;
        expect(state().sources).toEqual([folder("/a", { count: 25, pending: true })]);

        rescan.resolve(view(4, [folder("/a", { count: 5 })], 5));
        await toggling;
        expect(state().sources).toEqual([folder("/a", { count: 5 })]);
    });

    it("stops showing folders as being counted when a rescan fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockedAdd.mockResolvedValueOnce(view(1, [folder("/a", { count: 5 })], 5));
        await state().add(["/a"]);
        mockedRescan.mockRejectedValueOnce(new Error("boom"));

        await state().toggleScanSubfolders();

        expect(state().sources).toEqual([folder("/a", { count: 5 })]);
    });

    it("refreshes by recounting every folder with the current setting, keeping it", async () => {
        mockedAdd.mockResolvedValueOnce(view(1, [folder("/a", { count: 5 })], 5));
        await state().add(["/a"]);

        const rescan = deferred<SetView>();
        mockedRescan.mockReturnValueOnce(rescan.promise);
        const refreshing = state().refresh();

        expect(mockedRescan).toHaveBeenCalledExactlyOnceWith(false);
        expect(state().rescans).toBe(1);
        expect(state().sources).toEqual([folder("/a", { count: 5, pending: true })]);

        rescan.resolve(view(2, [folder("/a", { count: 4 })], 4));
        await refreshing;

        expect(state().scanSubfolders).toBe(false);
        expect(state().rescans).toBe(0);
        expect(state().sources).toEqual([folder("/a", { count: 4 })]);
    });

    it("adds with the current subfolder setting", async () => {
        mockedRescan.mockResolvedValue(view(1, []));
        mockedAdd.mockResolvedValue(view(2, []));

        await state().toggleScanSubfolders();
        await state().add(["/a"]);

        expect(mockedAdd).toHaveBeenCalledExactlyOnceWith(["/a"], true);
    });

    describe("following the Scan subfolders setting", () => {
        it("starts from a stored setting of on", async () => {
            localStorage.setItem(
                "settings-storage",
                JSON.stringify({ state: { ...SETTINGS_DEFAULTS, scanSubfolders: true }, version: 1 }),
            );
            vi.resetModules();

            const { useStartStore: launched } = await import("@/stores/start");

            expect(launched.getState().scanSubfolders).toBe(true);
        });

        it("checks and recounts when the setting is turned on", async () => {
            const rescan = deferred<SetView>();
            mockedRescan.mockReturnValueOnce(rescan.promise);

            useSettingsStore.getState().update({ scanSubfolders: true });

            expect(state().scanSubfolders).toBe(true);
            expect(mockedRescan).toHaveBeenCalledExactlyOnceWith(true);
            expect(state().rescans).toBe(1);

            rescan.resolve(view(1, [folder("/a", { count: 5 })], 5));
            await vi.waitFor(() => expect(state().rescans).toBe(0));
            expect(state().view.total).toBe(5);
        });

        it("doesn't recount when the setting changes to what the checkbox already shows", async () => {
            mockedRescan.mockResolvedValueOnce(view(1, []));
            await state().toggleScanSubfolders();
            mockedRescan.mockClear();

            useSettingsStore.getState().update({ scanSubfolders: true });

            expect(state().scanSubfolders).toBe(true);
            expect(mockedRescan).not.toHaveBeenCalled();
        });

        it("unchecks it again on Reset to defaults", () => {
            mockedRescan.mockResolvedValue(view(1, []));
            useSettingsStore.getState().update({ scanSubfolders: true });

            useSettingsStore.getState().reset();

            expect(state().scanSubfolders).toBe(false);
            expect(mockedRescan).toHaveBeenLastCalledWith(false);
        });

        it("leaves the setting alone when the checkbox is toggled", async () => {
            mockedRescan.mockResolvedValueOnce(view(1, []));

            await state().toggleScanSubfolders();

            expect(state().scanSubfolders).toBe(true);
            expect(useSettingsStore.getState().scanSubfolders).toBe(false);
        });
    });
});
