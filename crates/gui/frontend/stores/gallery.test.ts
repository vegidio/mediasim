import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { listSetMedia, rescanSet, type SetMedia, type SetView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";

vi.mock("@/ipc/set", () => ({
    addToSet: vi.fn(),
    removeFromSet: vi.fn(),
    rescanSet: vi.fn(),
    listSetMedia: vi.fn(),
}));

const mockedList = listSetMedia as Mock;
const mockedRescan = rescanSet as Mock;

const file = (name: string): MediaFile => ({
    path: `/p/${name}`,
    name,
    type: "image",
    size: 1,
    identity: name.padEnd(16, "0"),
});

const media = (revision: number, files: MediaFile[]): SetMedia => ({ revision, files });

/** Show the Home store at `revision`, with nothing being counted. */
const atRevision = (revision: number) => {
    const view: SetView = { revision, sources: [], total: 0 };
    useHomeStore.setState({ view, sources: [], rescans: 0 });
};

/** A promise the test resolves when it chooses, to order responses. */
const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

const state = () => useGalleryStore.getState();

describe("useGalleryStore", () => {
    beforeEach(() => {
        localStorage.clear();
        mockedList.mockReset();
        mockedRescan.mockReset().mockResolvedValue({ revision: 0, sources: [], total: 0 });
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useHomeStore.setState(useHomeStore.getInitialState(), true);
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    });

    it("starts with both kinds, the default threshold and nothing read", () => {
        expect(state().filter).toBe("both");
        expect(state().threshold).toBe(80);
        expect(state().listing).toEqual({ status: "idle" });
    });

    it("follows the default match threshold and Reset to defaults", () => {
        state().setThreshold(72);

        useSettingsStore.getState().update({ matchThreshold: 85 });
        expect(state().threshold).toBe(85);

        useSettingsStore.getState().reset();
        expect(state().threshold).toBe(80);
    });

    it("never writes the setting when the threshold moves", () => {
        useSettingsStore.getState().update({ matchThreshold: 90 });

        state().setThreshold(72);

        expect(state().threshold).toBe(72);
        expect(useSettingsStore.getState().matchThreshold).toBe(90);
    });

    it("starts a new comparison from the default match threshold", () => {
        useSettingsStore.getState().update({ matchThreshold: 90 });
        state().setThreshold(72);

        state().begin();

        expect(state().threshold).toBe(90);
    });

    it("starts the frame options from the stored settings", async () => {
        localStorage.setItem(
            "settings-storage",
            JSON.stringify({ state: { frameRotate: true, frameFlip: false }, version: 1 }),
        );
        vi.resetModules();

        const { useGalleryStore: fresh } = await import("@/stores/gallery");

        expect(fresh.getState().frameRotate).toBe(true);
        expect(fresh.getState().frameFlip).toBe(false);
    });

    it("never writes the settings when the frame options flip", () => {
        state().setFrameRotate(false);
        state().setFrameFlip(false);

        expect(state().frameRotate).toBe(false);
        expect(state().frameFlip).toBe(false);
        expect(useSettingsStore.getState().frameRotate).toBe(true);
        expect(useSettingsStore.getState().frameFlip).toBe(true);
    });

    it("starts a new comparison from the frame settings", () => {
        useSettingsStore.getState().update({ frameRotate: false });
        state().setFrameRotate(true);
        state().setFrameFlip(false);

        state().begin();

        expect(state().frameRotate).toBe(false);
        expect(state().frameFlip).toBe(true);
    });

    it("moves only the frame option whose setting changed", () => {
        state().setFrameRotate(false);
        state().setFrameFlip(false);

        useSettingsStore.getState().update({ frameFlip: false });
        useSettingsStore.getState().update({ frameFlip: true });

        expect(state().frameFlip).toBe(true);
        expect(state().frameRotate).toBe(false);
    });

    it("keeps unticked frame options when Reset to defaults changes neither setting", () => {
        state().setFrameRotate(false);
        state().setFrameFlip(false);

        useSettingsStore.getState().reset();

        expect(state().frameRotate).toBe(false);
        expect(state().frameFlip).toBe(false);
    });

    it("recounts the set when a new comparison starts, then reads the files again", async () => {
        atRevision(2);
        mockedList.mockResolvedValueOnce(media(2, [file("a.jpg"), file("b.jpg")]));
        await state().load();

        // b.jpg was deleted on disk; the set itself did not change, so only the recount can notice.
        const rescan = deferred<SetView>();
        mockedRescan.mockReturnValueOnce(rescan.promise);
        mockedList.mockResolvedValueOnce(media(3, [file("a.jpg")]));

        state().begin();
        const loading = state().load();

        expect(mockedRescan).toHaveBeenCalledExactlyOnceWith(false);
        expect(state().listing).toEqual({ status: "loading" });

        rescan.resolve({ revision: 3, sources: [], total: 1 });
        await loading;

        expect(mockedList).toHaveBeenCalledTimes(2);
        expect(state().listing).toEqual({ status: "ready", revision: 3, files: [file("a.jpg")] });
    });

    it("reads the files once per revision of the set", async () => {
        atRevision(2);
        mockedList.mockResolvedValue(media(2, [file("a.jpg")]));

        await state().load();
        await state().load();

        expect(mockedList).toHaveBeenCalledOnce();
        expect(state().listing).toEqual({ status: "ready", revision: 2, files: [file("a.jpg")] });

        atRevision(3);
        mockedList.mockResolvedValue(media(3, [file("a.jpg"), file("b.jpg")]));
        await state().load();

        expect(mockedList).toHaveBeenCalledTimes(2);
        expect(state().listing).toEqual({ status: "ready", revision: 3, files: [file("a.jpg"), file("b.jpg")] });
    });

    it("waits for a running rescan before reading", async () => {
        atRevision(2);
        useHomeStore.setState({ rescans: 1 });
        mockedList.mockResolvedValue(media(3, [file("a.jpg")]));

        const loading = state().load();
        await Promise.resolve();

        expect(state().listing).toEqual({ status: "loading" });
        expect(mockedList).not.toHaveBeenCalled();

        useHomeStore.setState({ rescans: 0, view: { revision: 3, sources: [], total: 1 } });
        await loading;

        expect(mockedList).toHaveBeenCalledOnce();
        expect(state().listing).toEqual({ status: "ready", revision: 3, files: [file("a.jpg")] });
    });

    it("keeps only the newest read when an older one answers last", async () => {
        atRevision(2);
        const older = deferred<SetMedia>();
        mockedList.mockReturnValueOnce(older.promise).mockResolvedValueOnce(media(2, [file("b.jpg")]));

        const first = state().load();
        await state().load();
        older.resolve(media(2, [file("a.jpg")]));
        await first;

        expect(state().listing).toEqual({ status: "ready", revision: 2, files: [file("b.jpg")] });
    });

    it("fails, then reads again on retry", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        atRevision(1);
        mockedList.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(media(1, [file("a.jpg")]));

        await state().load();
        expect(state().listing).toEqual({ status: "failed" });

        await state().load();
        expect(state().listing).toEqual({ status: "ready", revision: 1, files: [file("a.jpg")] });
    });

    describe("media details", () => {
        it("opens on a file, steps to another and closes, selecting the last file's tile and asking for grid focus", () => {
            state().select("/p/a.jpg");
            state().openDetails("/p/a.jpg");
            expect(state().details).toBe("/p/a.jpg");

            state().showDetails("/p/b.jpg");
            state().closeDetails();

            expect(state().details).toBeUndefined();
            expect(state().selected).toBe("/p/b.jpg");
            expect(state().focusGrid).toEqual({ reveal: true });

            state().gridFocused();
            expect(state().focusGrid).toBeUndefined();
            expect(state().selected).toBe("/p/b.jpg");
        });

        it("forgets a grid focus request still pending when it opens again", () => {
            state().openDetails("/p/a.jpg");
            state().closeDetails();

            state().openDetails("/p/b.jpg");

            expect(state().focusGrid).toBeUndefined();
        });

        it("asks the grid for focus where it stands, as after a click on a filter tab", () => {
            state().returnToGrid();

            expect(state().focusGrid).toEqual({ reveal: false });
        });

        it("closes when a new listing no longer holds its file", async () => {
            atRevision(2);
            mockedList.mockResolvedValue(media(2, [file("a.jpg"), file("b.jpg")]));
            await state().load();
            state().openDetails("/p/b.jpg");

            atRevision(3);
            mockedList.mockResolvedValue(media(3, [file("a.jpg"), file("b.jpg"), file("c.jpg")]));
            await state().load();
            expect(state().details).toBe("/p/b.jpg");

            atRevision(4);
            mockedList.mockResolvedValue(media(4, [file("a.jpg")]));
            await state().load();
            expect(state().details).toBeUndefined();
        });
    });

    describe("selection", () => {
        it("starts with none, selects one tile at a time, and clears", () => {
            expect(state().selected).toBeUndefined();

            state().select("/p/a.jpg");
            state().select("/p/b.jpg");
            expect(state().selected).toBe("/p/b.jpg");

            state().clearSelection();
            expect(state().selected).toBeUndefined();
        });

        it("is kept across a tab change", () => {
            state().select("/p/b.mp4");

            state().setFilter("images");

            expect(state().selected).toBe("/p/b.mp4");
        });

        it("starts a new comparison with none", () => {
            state().select("/p/a.jpg");

            state().begin();

            expect(state().selected).toBeUndefined();
        });

        it("is kept across a re-read that still holds the file, and cleared by one that doesn't", async () => {
            atRevision(2);
            mockedList.mockResolvedValue(media(2, [file("a.jpg"), file("b.jpg")]));
            await state().load();
            state().select("/p/b.jpg");

            atRevision(3);
            mockedList.mockResolvedValue(media(3, [file("a.jpg"), file("b.jpg"), file("c.jpg")]));
            await state().load();
            expect(state().selected).toBe("/p/b.jpg");

            atRevision(4);
            mockedList.mockResolvedValue(media(4, [file("a.jpg")]));
            await state().load();
            expect(state().selected).toBeUndefined();
        });
    });

    describe("overrides", () => {
        it("starts with none, and toggling a file twice returns to the start", () => {
            expect(state().overrides).toEqual(new Set());

            state().toggle("/p/a.jpg");
            state().toggle("/p/b.jpg");
            expect(state().overrides).toEqual(new Set(["/p/a.jpg", "/p/b.jpg"]));

            state().toggle("/p/a.jpg");
            expect(state().overrides).toEqual(new Set(["/p/b.jpg"]));
        });

        it("hands selectors a new set on each change", () => {
            const before = state().overrides;

            state().toggle("/p/a.jpg");

            expect(state().overrides).not.toBe(before);
        });

        it("clears them when another tab is selected", () => {
            state().setFilter("images");
            state().toggle("/p/a.jpg");
            state().toggle("/p/b.mp4");

            state().setFilter("videos");

            expect(state().filter).toBe("videos");
            expect(state().overrides).toEqual(new Set());
        });

        it("keeps them when the selected tab is selected again", () => {
            state().setFilter("images");
            state().toggle("/p/a.jpg");
            const before = state().overrides;

            state().setFilter("images");

            expect(state().overrides).toBe(before);
        });

        it("starts a new comparison with none", () => {
            state().toggle("/p/a.jpg");

            state().begin();

            expect(state().overrides).toEqual(new Set());
        });

        it("keeps an override across a re-read that still holds the file", async () => {
            atRevision(2);
            mockedList.mockResolvedValue(media(2, [file("a.jpg"), file("b.jpg")]));
            await state().load();
            state().toggle("/p/a.jpg");

            atRevision(3);
            mockedList.mockResolvedValue(media(3, [file("a.jpg"), file("b.jpg"), file("c.jpg")]));
            await state().load();

            expect(state().overrides).toEqual(new Set(["/p/a.jpg"]));
        });

        it("forgets an override when a re-read no longer holds the file", async () => {
            atRevision(2);
            mockedList.mockResolvedValue(media(2, [file("a.jpg"), file("b.jpg")]));
            await state().load();
            state().toggle("/p/a.jpg");
            state().toggle("/p/b.jpg");

            atRevision(3);
            mockedList.mockResolvedValue(media(3, [file("b.jpg")]));
            await state().load();

            expect(state().overrides).toEqual(new Set(["/p/b.jpg"]));
        });
    });
});
