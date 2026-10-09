import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaType } from "@/ipc/formats";
import { cancelComparison, comparePair, type MediaInfo, type PairFailure, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import {
    type DeleteOutcome,
    deleteMedia,
    type RestoreOutcome,
    restoreMedia,
    type TrashOutcome,
    trashMedia,
} from "@/ipc/trash";
import { usePairStore } from "@/stores/pair";
import { usePairResultStore } from "@/stores/pairResult";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), restoreMedia: vi.fn(), deleteMedia: vi.fn() }));

const mockedProbe = probeMedia as Mock;
const mockedCompare = comparePair as Mock;
const mockedCancel = cancelComparison as Mock;
const mockedTrash = trashMedia as Mock;
const mockedRestore = restoreMedia as Mock;
const mockedDelete = deleteMedia as Mock;

const media = (name: string, type: MediaType = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

const info = (file: MediaFile): MediaInfo => ({ path: file.path, type: file.type, width: 10, height: 10, size: 1000 });

/** A promise the test settles when it chooses, to order responses. */
const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    let reject: (reason: unknown) => void = () => {};
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

/** Lets every settled promise's callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const state = () => usePairResultStore.getState();

const A = media("IMG_2041.jpg");
const B = media("IMG_2041-edit.jpg");

describe("usePairResultStore", () => {
    beforeEach(() => {
        usePairResultStore.setState(usePairResultStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
        usePairStore.setState(usePairStore.getInitialState(), true);
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        mockedProbe.mockReset();
        mockedCompare.mockReset();
        mockedCancel.mockReset().mockResolvedValue(undefined);
    });

    it("opens the pair screen, probing both files and comparing them", () => {
        mockedProbe.mockReturnValue(new Promise(() => {}));
        mockedCompare.mockReturnValue(new Promise(() => {}));

        state().open(A, B);

        expect(useScreenStore.getState().screen).toBe("pair");
        expect(state().files).toEqual({ a: A, b: B });
        expect(state().details).toEqual({ a: { status: "loading" }, b: { status: "loading" } });
        expect(state().comparison).toEqual({ status: "comparing" });
        expect(mockedProbe).toHaveBeenCalledWith(A.path);
        expect(mockedProbe).toHaveBeenCalledWith(B.path);
        expect(mockedCompare).toHaveBeenCalledExactlyOnceWith(A.path, B.path);
    });

    it("applies each pane's details on their own, before the score", async () => {
        const probeA = deferred<MediaInfo>();
        const probeB = deferred<MediaInfo>();
        mockedProbe.mockImplementation((path: string) => (path === A.path ? probeA.promise : probeB.promise));
        mockedCompare.mockReturnValue(new Promise(() => {}));
        state().open(A, B);

        probeB.resolve(info(B));
        await settle();

        expect(state().details.a).toEqual({ status: "loading" });
        expect(state().details.b).toEqual({ status: "ready", info: info(B) });

        probeA.reject({ kind: "load", path: A.path, message: "boom" });
        await settle();

        expect(state().details.a).toEqual({ status: "failed" });
        expect(state().comparison).toEqual({ status: "comparing" });
    });

    it("shows the similarity once the comparison finishes", async () => {
        mockedProbe.mockImplementation(async (path: string) => info(path === A.path ? A : B));
        mockedCompare.mockResolvedValue(0.9487);

        state().open(A, B);
        await settle();

        expect(state().comparison).toEqual({ status: "done", similarity: 0.9487 });
    });

    it("shows a failed comparison with its reason", async () => {
        const failure: PairFailure = { kind: "load", path: B.path, message: "failed to load video" };
        mockedProbe.mockReturnValue(new Promise(() => {}));
        mockedCompare.mockRejectedValue(failure);

        state().open(A, B);
        await settle();

        expect(state().comparison).toEqual({ status: "failed", error: failure });
    });

    it("leaves for the Home screen and cancels the comparison", () => {
        mockedProbe.mockReturnValue(new Promise(() => {}));
        mockedCompare.mockReturnValue(new Promise(() => {}));
        state().open(A, B);

        state().leave();

        expect(useScreenStore.getState().screen).toBe("home");
        expect(useScreenStore.getState().takePrevious()).toBe("pair");
        expect(mockedCancel).toHaveBeenCalledOnce();
    });

    it("ignores every result that arrives after leaving", async () => {
        const probe = deferred<MediaInfo>();
        const comparison = deferred<number>();
        mockedProbe.mockReturnValue(probe.promise);
        mockedCompare.mockReturnValue(comparison.promise);
        state().open(A, B);

        state().leave();
        probe.resolve(info(A));
        comparison.reject({ kind: "cancelled" });
        await settle();

        expect(state().details).toEqual({ a: { status: "loading" }, b: { status: "loading" } });
        expect(state().comparison).toEqual({ status: "comparing" });
    });

    it("ignores every result of a pair replaced by a newer one", async () => {
        const old = { probe: deferred<MediaInfo>(), comparison: deferred<number>() };
        const C = media("other.jpg");
        mockedProbe.mockReturnValueOnce(old.probe.promise).mockReturnValueOnce(old.probe.promise);
        mockedCompare.mockReturnValueOnce(old.comparison.promise);
        state().open(A, B);

        mockedProbe.mockReturnValue(new Promise(() => {}));
        mockedCompare.mockReturnValue(new Promise(() => {}));
        state().open(A, C);
        old.probe.resolve(info(B));
        old.comparison.resolve(0.5);
        await settle();

        expect(state().files).toEqual({ a: A, b: C });
        expect(state().details).toEqual({ a: { status: "loading" }, b: { status: "loading" } });
        expect(state().comparison).toEqual({ status: "comparing" });
    });

    it("retries the comparison only, keeping the details already read", async () => {
        const probeB = deferred<MediaInfo>();
        mockedProbe.mockImplementation(async (path: string) => (path === A.path ? info(A) : probeB.promise));
        mockedCompare.mockRejectedValueOnce({ kind: "task", message: "panic" });
        state().open(A, B);
        await settle();
        expect(state().comparison.status).toBe("failed");

        mockedCompare.mockResolvedValueOnce(0.29);
        state().retry();

        expect(state().comparison).toEqual({ status: "comparing" });
        expect(state().details.a).toEqual({ status: "ready", info: info(A) });
        expect(mockedProbe).toHaveBeenCalledTimes(2);
        expect(mockedCompare).toHaveBeenCalledTimes(2);

        // A probe still reading when the comparison was retried still lands.
        probeB.resolve(info(B));
        await settle();

        expect(state().details.b).toEqual({ status: "ready", info: info(B) });
        expect(state().comparison).toEqual({ status: "done", similarity: 0.29 });
    });

    it("ignores the result of a comparison replaced by a retry", async () => {
        const first = deferred<number>();
        mockedProbe.mockReturnValue(new Promise(() => {}));
        mockedCompare.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
        state().open(A, B);

        state().retry();
        first.resolve(0.5);
        await settle();

        expect(state().comparison).toEqual({ status: "comparing" });
    });

    it("leaves the Home screen's slots untouched through the round trip", async () => {
        usePairStore.setState({ a: A, b: B });
        const before = usePairStore.getState();
        mockedProbe.mockImplementation(async (path: string) => info(path === A.path ? A : B));
        mockedCompare.mockResolvedValue(1);

        state().open(A, B);
        await settle();
        state().retry();
        await settle();
        state().leave();

        expect(usePairStore.getState()).toBe(before);
        expect(usePairStore.getState()).toMatchObject({ a: A, b: B });
    });

    describe("marks", () => {
        beforeEach(() => {
            mockedProbe.mockReturnValue(new Promise(() => {}));
            mockedCompare.mockReturnValue(new Promise(() => {}));
        });

        it("starts with neither file marked", () => {
            expect(state().marked).toEqual({ a: false, b: false });
        });

        it("marks and unmarks one file, leaving the other", () => {
            state().toggleMark("b");
            expect(state().marked).toEqual({ a: false, b: true });

            state().toggleMark("b");
            expect(state().marked).toEqual({ a: false, b: false });
        });

        it("marks both files at once", () => {
            state().toggleMark("a");
            state().toggleMark("b");

            expect(state().marked).toEqual({ a: true, b: true });
        });

        it("resets the marks when a pair opens", () => {
            state().open(A, B);
            state().toggleMark("a");
            state().toggleMark("b");

            state().open(A, B);

            expect(state().marked).toEqual({ a: false, b: false });
        });

        it("keeps the marks through a retry", () => {
            state().open(A, B);
            state().toggleMark("b");

            state().retry();

            expect(state().marked).toEqual({ a: false, b: true });
        });
    });

    describe("deletion", () => {
        const TRASHED: TrashOutcome = { status: "trashed" };
        const failed = (message: string): TrashOutcome => ({ status: "failed", reason: "trash", message });

        beforeEach(() => {
            mockedProbe.mockReturnValue(new Promise(() => {}));
            mockedCompare.mockReturnValue(new Promise(() => {}));
            mockedTrash.mockReset();
            usePairStore.setState({ a: A, b: B });
            state().open(A, B);
        });

        /** Marks `slots`, confirms, and moves them with the outcomes given. */
        const move = async (slots: ("a" | "b")[], outcomes: TrashOutcome[]) => {
            for (const slot of slots) state().toggleMark(slot);
            mockedTrash.mockResolvedValue(outcomes);
            state().requestDeletion();
            await state().removeMarked();
        };

        it("starts idle, with nothing gone and no notice", () => {
            expect(state().deletion).toEqual({ status: "idle" });
            expect(state().gone).toEqual({});
            expect(state().notice).toBeUndefined();
        });

        it("does not confirm with nothing marked", () => {
            state().requestDeletion();

            expect(state().deletion).toEqual({ status: "idle" });
        });

        it("cancels back to idle, keeping the marks and moving nothing", () => {
            state().toggleMark("b");
            state().requestDeletion();
            expect(state().deletion).toEqual({ status: "confirming", mode: "trash" });

            state().cancelDeletion();

            expect(state().deletion).toEqual({ status: "idle" });
            expect(state().marked).toEqual({ a: false, b: true });
            expect(mockedTrash).not.toHaveBeenCalled();
        });

        it("moves nothing unless confirming", async () => {
            state().toggleMark("b");

            await state().removeMarked();

            expect(mockedTrash).not.toHaveBeenCalled();
        });

        it("is removing while the call is pending", async () => {
            const pending = deferred<TrashOutcome[]>();
            mockedTrash.mockReturnValue(pending.promise);
            state().toggleMark("b");
            state().requestDeletion();

            const run = state().removeMarked();

            expect(state().deletion).toEqual({ status: "removing", mode: "trash", confirmed: true });
            pending.resolve([TRASHED]);
            await run;
            expect(state().deletion).toEqual({ status: "idle" });
        });

        it("sends the marked identities in A, B order", async () => {
            state().toggleMark("b");
            await move(["a"], [TRASHED, TRASHED]);

            expect(mockedTrash).toHaveBeenCalledExactlyOnceWith([A.identity, B.identity]);
        });

        it("does not request while a restore runs", async () => {
            await move(["b"], [TRASHED]);
            state().toggleMark("a");
            useSettingsStore.setState({ deletionMode: "permanent", confirmDeletion: false });
            mockedRestore.mockReturnValue(new Promise(() => {}));
            void state().restore(["b"]);

            await state().requestDeletion();

            expect(state().deletion).toEqual({ status: "restoring" });
            expect(mockedDelete).not.toHaveBeenCalled();
            expect(mockedTrash).toHaveBeenCalledOnce();
        });

        it("marks a moved file gone and unmarked, and empties its start slot", async () => {
            await move(["b"], [TRASHED]);

            expect(state().gone).toEqual({ b: "trash" });
            expect(state().marked).toEqual({ a: false, b: false });
            expect(state().notice).toEqual({ action: "trash", done: ["b"], failed: [] });
            expect(usePairStore.getState().a).toEqual(A);
            expect(usePairStore.getState().b).toBeUndefined();
        });

        it("keeps a failed file marked and in its start slot, and still moves the other", async () => {
            await move(["a", "b"], [failed("the folder is read-only"), TRASHED]);

            expect(state().gone).toEqual({ b: "trash" });
            expect(state().marked).toEqual({ a: true, b: false });
            expect(state().notice).toEqual({
                action: "trash",
                done: ["b"],
                failed: [{ key: "a", message: "the folder is read-only" }],
            });
            expect(usePairStore.getState().a).toEqual(A);
            expect(usePairStore.getState().b).toBeUndefined();
        });

        it("leaves a start slot alone once it holds another file", async () => {
            const other = media("other.jpg");
            usePairStore.setState({ b: other });

            await move(["b"], [TRASHED]);

            expect(usePairStore.getState().b).toEqual(other);
        });

        it("fails every file when the call rejects", async () => {
            state().toggleMark("a");
            state().toggleMark("b");
            mockedTrash.mockRejectedValue("command trash_media not found");
            state().requestDeletion();

            await state().removeMarked();

            expect(state().gone).toEqual({});
            expect(state().marked).toEqual({ a: true, b: true });
            expect(state().notice).toEqual({
                action: "trash",
                done: [],
                failed: [
                    { key: "a", message: "command trash_media not found" },
                    { key: "b", message: "command trash_media not found" },
                ],
            });
            expect(usePairStore.getState()).toMatchObject({ a: A, b: B });
        });

        it("keeps the screen as left by a move that finishes after leaving, but still empties the start slot", async () => {
            usePairStore.setState({ a: A, b: B });
            const pending = deferred<TrashOutcome[]>();
            mockedTrash.mockReturnValue(pending.promise);
            state().toggleMark("b");
            state().requestDeletion();
            const run = state().removeMarked();

            state().leave();
            expect(state().deletion).toEqual({ status: "idle" });
            pending.resolve([TRASHED]);
            await run;

            expect(state().gone).toEqual({});
            expect(state().notice).toBeUndefined();
            expect(state().deletion).toEqual({ status: "idle" });
            expect(usePairStore.getState().a).toEqual(A);
            expect(usePairStore.getState().b).toBeUndefined();
        });

        it("empties the start slot for a move that finishes after another pair opened", async () => {
            usePairStore.setState({ a: A, b: B });
            const pending = deferred<TrashOutcome[]>();
            mockedTrash.mockReturnValue(pending.promise);
            state().toggleMark("b");
            state().requestDeletion();
            const run = state().removeMarked();

            state().open(A, B);
            pending.resolve([TRASHED]);
            await run;

            expect(state().gone).toEqual({});
            expect(state().deletion).toEqual({ status: "idle" });
            expect(usePairStore.getState().b).toBeUndefined();
        });

        it("dismisses the notice, keeping the file gone", async () => {
            await move(["b"], [TRASHED]);

            state().dismissNotice();

            expect(state().notice).toBeUndefined();
            expect(state().gone.b).toBe("trash");
        });

        it("resets everything when a pair opens", async () => {
            await move(["b"], [TRASHED]);

            state().open(A, B);

            expect(state().gone).toEqual({});
            expect(state().marked).toEqual({ a: false, b: false });
            expect(state().deletion).toEqual({ status: "idle" });
            expect(state().notice).toBeUndefined();
        });

        it("clears the notice on leaving", async () => {
            await move(["b"], [TRASHED]);

            state().leave();

            expect(state().notice).toBeUndefined();
        });

        describe("permanent mode and confirmation", () => {
            const DELETED: DeleteOutcome = { status: "deleted" };

            beforeEach(() => {
                mockedDelete.mockReset();
            });

            it("deletes the marked files, recording them as deleted with a delete notice, and empties the start slot", async () => {
                useSettingsStore.setState({ deletionMode: "permanent" });
                state().toggleMark("b");
                mockedDelete.mockResolvedValue([DELETED]);

                state().requestDeletion();
                expect(state().deletion).toEqual({ status: "confirming", mode: "permanent" });
                await state().removeMarked();

                expect(mockedDelete).toHaveBeenCalledExactlyOnceWith([B.identity]);
                expect(mockedTrash).not.toHaveBeenCalled();
                expect(state().gone).toEqual({ b: "permanent" });
                expect(state().marked).toEqual({ a: false, b: false });
                expect(state().notice).toEqual({ action: "permanent", done: ["b"], failed: [] });
                expect(usePairStore.getState().b).toBeUndefined();
            });

            it("keeps a file that fails to delete marked, and fails every file when the call rejects", async () => {
                useSettingsStore.setState({ deletionMode: "permanent" });
                state().toggleMark("a");
                state().toggleMark("b");
                mockedDelete.mockRejectedValue("command delete_media not found");

                state().requestDeletion();
                await state().removeMarked();

                expect(state().gone).toEqual({});
                expect(state().marked).toEqual({ a: true, b: true });
                expect(state().notice).toEqual({
                    action: "permanent",
                    done: [],
                    failed: [
                        { key: "a", message: "command delete_media not found" },
                        { key: "b", message: "command delete_media not found" },
                    ],
                });
            });

            it.each([
                ["trash", mockedTrash, { status: "trashed" }, "trash"],
                ["permanent", mockedDelete, DELETED, "permanent"],
            ] as const)("skips confirming with confirm off, in %s mode", async (mode, mocked, outcome, kind) => {
                useSettingsStore.setState({ deletionMode: mode, confirmDeletion: false });
                state().toggleMark("b");
                const pending = deferred<unknown[]>();
                mocked.mockReturnValue(pending.promise);

                const run = state().requestDeletion();

                expect(state().deletion).toEqual({ status: "removing", mode, confirmed: false });
                pending.resolve([outcome]);
                await run;
                expect(state().deletion).toEqual({ status: "idle" });
                expect(state().gone).toEqual({ b: kind });
            });

            it("keeps the mode asked for even if Settings changes before confirming", async () => {
                state().toggleMark("b");
                mockedTrash.mockResolvedValue([TRASHED]);
                state().requestDeletion();

                useSettingsStore.setState({ deletionMode: "permanent" });
                await state().removeMarked();

                expect(mockedTrash).toHaveBeenCalledOnce();
                expect(mockedDelete).not.toHaveBeenCalled();
                expect(state().gone).toEqual({ b: "trash" });
            });

            it("never restores a deleted file", async () => {
                mockedRestore.mockReset();
                await move(["a"], [TRASHED]);
                useSettingsStore.setState({ deletionMode: "permanent" });
                mockedDelete.mockResolvedValue([DELETED]);
                state().toggleMark("b");
                state().requestDeletion();
                await state().removeMarked();
                mockedRestore.mockResolvedValue([{ status: "restored", identity: A.identity }]);

                await state().restore(["a", "b"]);

                expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([A.identity]);
                expect(state().gone).toEqual({ b: "permanent" });
            });
        });

        describe("restore", () => {
            const restored = (identity: string): RestoreOutcome => ({ status: "restored", identity });
            const occupied: RestoreOutcome = {
                status: "failed",
                reason: "occupied",
                message: "a file with its name is already in its folder",
            };

            beforeEach(() => {
                mockedRestore.mockReset();
            });

            it("restores nothing that isn't in the Trash", async () => {
                await state().restore(["a", "b"]);

                expect(mockedRestore).not.toHaveBeenCalled();
                expect(state().deletion).toEqual({ status: "idle" });
            });

            it("is restoring while the call is pending, and no move can start then", async () => {
                await move(["b"], [TRASHED]);
                state().toggleMark("a");
                const pending = deferred<RestoreOutcome[]>();
                mockedRestore.mockReturnValue(pending.promise);

                const run = state().restore(["b"]);

                expect(state().deletion).toEqual({ status: "restoring" });
                state().requestDeletion();
                expect(state().deletion).toEqual({ status: "restoring" });
                pending.resolve([restored("id-new")]);
                await run;
                expect(state().deletion).toEqual({ status: "idle" });
            });

            it("puts a restored file back in place, unmarked, under its new identity, and refills its start slot", async () => {
                await move(["b"], [TRASHED]);
                mockedRestore.mockResolvedValue([restored("id-new")]);

                await state().restore(["b"]);

                expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([B.identity]);
                expect(state().gone).toEqual({});
                expect(state().marked).toEqual({ a: false, b: false });
                expect(state().files?.b).toEqual({ ...B, identity: "id-new" });
                expect(state().files?.a).toEqual(A);
                expect(state().notice).toEqual({ action: "restore", done: ["b"], failed: [] });
                expect(usePairStore.getState().b).toEqual({ ...B, identity: "id-new" });
            });

            it("keeps a file placed in the start slot since", async () => {
                await move(["b"], [TRASHED]);
                const other = media("other.jpg");
                usePairStore.setState({ b: other });
                mockedRestore.mockResolvedValue([restored("id-new")]);

                await state().restore(["b"]);

                expect(usePairStore.getState().b).toEqual(other);
            });

            it("keeps a file that fails gone, restores the other, and lists both", async () => {
                await move(["a", "b"], [TRASHED, TRASHED]);
                mockedRestore.mockResolvedValue([occupied, restored(B.identity)]);

                await state().restore(["a", "b"]);

                expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([A.identity, B.identity]);
                expect(state().gone).toEqual({ a: "trash" });
                expect(state().notice).toEqual({
                    action: "restore",
                    done: ["b"],
                    failed: [{ key: "a", message: occupied.message }],
                });
                expect(usePairStore.getState().a).toBeUndefined();
                expect(usePairStore.getState().b).toEqual(B);
            });

            it("restores only the slots asked for", async () => {
                await move(["a", "b"], [TRASHED, TRASHED]);
                mockedRestore.mockResolvedValue([restored(A.identity)]);

                await state().restore(["a"]);

                expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([A.identity]);
                expect(state().gone).toEqual({ b: "trash" });
            });

            it("fails every file when the call rejects", async () => {
                await move(["a", "b"], [TRASHED, TRASHED]);
                mockedRestore.mockRejectedValue("command restore_media not found");

                await state().restore(["a", "b"]);

                expect(state().gone).toEqual({ a: "trash", b: "trash" });
                expect(state().deletion).toEqual({ status: "idle" });
                expect(state().notice).toEqual({
                    action: "restore",
                    done: [],
                    failed: [
                        { key: "a", message: "command restore_media not found" },
                        { key: "b", message: "command restore_media not found" },
                    ],
                });
            });

            it.each([
                ["leaving", () => state().leave()],
                ["opening a new pair", () => state().open(A, B)],
            ])(
                "keeps the screen as it is for a restore that finishes after %s, but refills the start slot",
                async (_, interrupt) => {
                    await move(["b"], [TRASHED]);
                    const pending = deferred<RestoreOutcome[]>();
                    mockedRestore.mockReturnValue(pending.promise);
                    const run = state().restore(["b"]);

                    interrupt();
                    const before = state();
                    pending.resolve([restored("id-new")]);
                    await run;

                    expect(state().gone).toEqual(before.gone);
                    expect(state().files).toEqual(before.files);
                    expect(state().notice).toBeUndefined();
                    expect(state().deletion).toEqual({ status: "idle" });
                    expect(usePairStore.getState().b).toEqual({ ...B, identity: "id-new" });
                },
            );

            it("leaves the details and the comparison as they were", async () => {
                await move(["b"], [TRASHED]);
                const { details, comparison } = state();
                mockedRestore.mockResolvedValue([restored("id-new")]);

                await state().restore(["b"]);

                expect(state().details).toBe(details);
                expect(state().comparison).toBe(comparison);
                expect(mockedCompare).toHaveBeenCalledTimes(1);
            });
        });
    });
});
