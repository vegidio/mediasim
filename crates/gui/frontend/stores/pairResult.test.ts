import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaType } from "@/ipc/formats";
import { cancelComparison, comparePair, type MediaInfo, type PairFailure, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { usePairStore } from "@/stores/pair";
import { usePairResultStore } from "@/stores/pairResult";
import { useScreenStore } from "@/stores/screen";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));

const mockedProbe = probeMedia as Mock;
const mockedCompare = comparePair as Mock;
const mockedCancel = cancelComparison as Mock;

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

    it("leaves for the start screen and cancels the comparison", () => {
        mockedProbe.mockReturnValue(new Promise(() => {}));
        mockedCompare.mockReturnValue(new Promise(() => {}));
        state().open(A, B);

        state().leave();

        expect(useScreenStore.getState().screen).toBe("start");
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

    it("leaves the start screen's slots untouched through the round trip", async () => {
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
});
