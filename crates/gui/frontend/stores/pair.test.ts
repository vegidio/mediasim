import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaType } from "@/ipc/formats";
import { describeMedia, type MediaFile } from "@/ipc/thumbs";
import { selectCanCompare, selectMismatch, usePairStore } from "@/stores/pair";

vi.mock("@/ipc/thumbs", () => ({ describeMedia: vi.fn() }));

const mockedDescribe = describeMedia as Mock;

const media = (name: string, type: MediaType = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

/** A promise the test resolves when it chooses, to order responses. */
const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

const state = () => usePairStore.getState();

describe("usePairStore", () => {
    beforeEach(() => {
        usePairStore.setState(usePairStore.getInitialState(), true);
    });

    it("starts with both slots empty", () => {
        expect(state().a).toBeUndefined();
        expect(state().b).toBeUndefined();
    });

    it("places a picked file in its slot and leaves the other alone", async () => {
        mockedDescribe.mockResolvedValue([media("IMG_2041.jpg")]);

        await state().place("a", "/media/IMG_2041.jpg");

        expect(mockedDescribe).toHaveBeenCalledExactlyOnceWith(["/media/IMG_2041.jpg"]);
        expect(state().a).toEqual(media("IMG_2041.jpg"));
        expect(state().b).toBeUndefined();
    });

    it("leaves the slot as it was when the picked file can't be placed", async () => {
        usePairStore.setState({ a: media("a.jpg") });
        mockedDescribe.mockResolvedValue([undefined]);

        await state().place("a", "/media/gone.jpg");

        expect(state().a).toEqual(media("a.jpg"));
    });

    it("skips what can't be placed before routing a drop", async () => {
        mockedDescribe.mockResolvedValue([undefined, undefined, media("photo.jpg")]);

        await state().drop(["/media/folder", "/media/notes.txt", "/media/photo.jpg"], "b");

        expect(state().a).toBeUndefined();
        expect(state().b).toEqual(media("photo.jpg"));
    });

    it("fills A and B from a drop of two or more files", async () => {
        usePairStore.setState({ a: media("old.jpg") });
        mockedDescribe.mockResolvedValue([media("x.jpg"), media("y.jpg"), media("z.jpg")]);

        await state().drop(["/media/x.jpg", "/media/y.jpg", "/media/z.jpg"], "b");

        expect(state().a).toEqual(media("x.jpg"));
        expect(state().b).toEqual(media("y.jpg"));
    });

    it("puts one file dropped outside the slots in the first empty one", async () => {
        usePairStore.setState({ a: media("a.jpg") });
        mockedDescribe.mockResolvedValue([media("b.jpg")]);

        await state().drop(["/media/b.jpg"], undefined);

        expect(state().a).toEqual(media("a.jpg"));
        expect(state().b).toEqual(media("b.jpg"));
    });

    it("allows the same file in both slots", async () => {
        usePairStore.setState({ a: media("a.jpg") });
        mockedDescribe.mockResolvedValue([media("a.jpg")]);

        await state().drop(["/media/a.jpg"], "b");

        expect(state().a).toEqual(media("a.jpg"));
        expect(state().b).toEqual(media("a.jpg"));
    });

    it("empties a slot on remove and leaves the other alone", () => {
        usePairStore.setState({ a: media("a.jpg"), b: media("b.jpg") });

        state().remove("a");

        expect(state()).not.toHaveProperty("a");
        expect(state().b).toEqual(media("b.jpg"));
    });

    it("keeps an in-flight pick when a later drop routes nowhere", async () => {
        const pick = deferred<(MediaFile | undefined)[]>();
        mockedDescribe.mockReturnValueOnce(pick.promise).mockResolvedValueOnce([undefined]);

        const placing = state().place("a", "/media/big.mov");
        await state().drop(["/media/folder"], "a");
        pick.resolve([media("big.mov", "video")]);
        await placing;

        expect(state().a).toEqual(media("big.mov", "video"));
    });

    it("lets a later remove beat an earlier slow drop", async () => {
        const slow = deferred<(MediaFile | undefined)[]>();
        mockedDescribe.mockReturnValueOnce(slow.promise);

        const dropping = state().drop(["/media/big.mov"], "a");
        state().remove("a");
        slow.resolve([media("big.mov", "video")]);
        await dropping;

        expect(state().a).toBeUndefined();
    });

    it("lets a later drop beat an earlier slow drop", async () => {
        const slow = deferred<(MediaFile | undefined)[]>();
        mockedDescribe.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([media("small.jpg")]);

        const dropping = state().drop(["/media/big.mov"], "a");
        await state().drop(["/media/small.jpg"], "a");
        slow.resolve([media("big.mov", "video")]);
        await dropping;

        expect(state().a).toEqual(media("small.jpg"));
    });

    it("lets a later drop win when an earlier one finishes first", async () => {
        const first = deferred<(MediaFile | undefined)[]>();
        const second = deferred<(MediaFile | undefined)[]>();
        mockedDescribe.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        const earlier = state().drop(["/media/big.mov"], "a");
        const later = state().drop(["/media/small.jpg"], "a");
        first.resolve([media("big.mov", "video")]);
        await earlier;
        second.resolve([media("small.jpg")]);
        await later;

        expect(state().a).toEqual(media("small.jpg"));
    });

    it("lets a later drop beat an earlier slow pick", async () => {
        const pick = deferred<(MediaFile | undefined)[]>();
        mockedDescribe.mockReturnValueOnce(pick.promise).mockResolvedValueOnce([media("small.jpg")]);

        const placing = state().place("a", "/media/big.mov");
        await state().drop(["/media/small.jpg"], "a");
        pick.resolve([media("big.mov", "video")]);
        await placing;

        expect(state().a).toEqual(media("small.jpg"));
    });

    it("keeps both slots when describing fails", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        usePairStore.setState({ a: media("a.jpg") });
        mockedDescribe.mockRejectedValue(new Error("task failed"));

        await state().drop(["/media/x.jpg", "/media/y.jpg"], undefined);

        expect(state().a).toEqual(media("a.jpg"));
        expect(state().b).toBeUndefined();
        expect(consoleError).toHaveBeenCalledOnce();
    });
});

describe("selectMismatch and selectCanCompare", () => {
    beforeEach(() => {
        usePairStore.setState(usePairStore.getInitialState(), true);
    });

    it.each<[string, MediaFile | undefined, MediaFile | undefined, boolean, boolean]>([
        ["no files", undefined, undefined, false, false],
        ["only File A", media("a.jpg"), undefined, false, false],
        ["two images", media("a.jpg"), media("b.png"), false, true],
        ["two videos", media("a.mov", "video"), media("b.mp4", "video"), false, true],
        ["an image and a video", media("a.jpg"), media("b.mov", "video"), true, false],
        ["a video and an image", media("a.mov", "video"), media("b.jpg"), true, false],
    ])("%s", (_, a, b, mismatch, canCompare) => {
        usePairStore.setState({ ...(a && { a }), ...(b && { b }) });

        expect(selectMismatch(usePairStore.getState())).toBe(mismatch);
        expect(selectCanCompare(usePairStore.getState())).toBe(canCompare);
    });
});
