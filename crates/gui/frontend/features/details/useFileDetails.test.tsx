import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type MediaInfo, probeMedia } from "@/ipc/pair";
import { displayPath } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo, type VideoProbe } from "@/ipc/video";
import { forgetFileDetails, useFileDetails } from "./useFileDetails";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn() }));
vi.mock("@/ipc/set", () => ({ displayPath: vi.fn() }));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn() }));

const mockedProbe = probeMedia as Mock;
const mockedDisplay = displayPath as Mock;
const mockedVideo = probeVideo as Mock;

const file = (name: string, type: MediaFile["type"] = "image"): MediaFile => ({
    path: `/Users/me/${name}`,
    name,
    type,
    size: 1000,
    identity: name.padEnd(16, "0"),
});

const IMAGE = file("a.jpg");
const OTHER = file("b.jpg");
const VIDEO = file("c.mov", "video");

const info = ({ path, type }: MediaFile): MediaInfo => ({ path, type, width: 4, height: 3, size: 1000 });

const STREAMS: VideoProbe = { format: "mov", duration: 1, video: { codec: "hevc", decodable: true } };

/** A promise the test resolves when it chooses, to order responses. */
const deferred = <T,>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

beforeEach(() => {
    forgetFileDetails();
    mockedProbe.mockReset().mockImplementation(async (path: string) => info(path === VIDEO.path ? VIDEO : IMAGE));
    mockedDisplay.mockReset().mockImplementation(async (path: string) => path.replace("/Users/me", "~"));
    mockedVideo.mockReset().mockResolvedValue(STREAMS);
});

describe("useFileDetails", () => {
    it("loads, then is ready with the details and the display path", async () => {
        const { result } = renderHook(() => useFileDetails(IMAGE));

        expect(result.current).toEqual({ status: "loading" });
        await waitFor(() => expect(result.current).toEqual({ status: "ready", info: info(IMAGE), path: "~/a.jpg" }));
        expect(mockedVideo).not.toHaveBeenCalled();
    });

    it("reads a video's streams too", async () => {
        const { result } = renderHook(() => useFileDetails(VIDEO));

        await waitFor(() => expect(result.current).toMatchObject({ status: "ready", streams: STREAMS }));
        expect(mockedVideo).toHaveBeenCalledExactlyOnceWith(VIDEO.identity);
    });

    it("is still ready when a video's streams can't be read", async () => {
        mockedVideo.mockRejectedValue({ kind: "unreadable", message: "bad" });
        const { result } = renderHook(() => useFileDetails(VIDEO));

        await waitFor(() => expect(result.current.status).toBe("ready"));
        expect(result.current).not.toHaveProperty("streams");
    });

    it("probes each path once across remounts", async () => {
        const first = renderHook(() => useFileDetails(IMAGE));
        await waitFor(() => expect(first.result.current.status).toBe("ready"));
        first.unmount();

        const second = renderHook(() => useFileDetails(IMAGE));
        await waitFor(() => expect(second.result.current.status).toBe("ready"));

        expect(mockedProbe).toHaveBeenCalledOnce();
        expect(mockedDisplay).toHaveBeenCalledOnce();
    });

    it("fails, then probes again on a later read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mockedProbe.mockRejectedValueOnce({ kind: "load", path: IMAGE.path, message: "bad" });

        const first = renderHook(() => useFileDetails(IMAGE));
        await waitFor(() => expect(first.result.current).toEqual({ status: "failed" }));
        first.unmount();

        const second = renderHook(() => useFileDetails(IMAGE));
        await waitFor(() => expect(second.result.current.status).toBe("ready"));
        expect(mockedProbe).toHaveBeenCalledTimes(2);
    });

    it("ignores an answer for a file no longer shown", async () => {
        const slow = deferred<MediaInfo>();
        mockedProbe.mockImplementation((path: string) =>
            path === IMAGE.path ? slow.promise : Promise.resolve(info(OTHER)),
        );

        const { result, rerender } = renderHook(({ shown }) => useFileDetails(shown), {
            initialProps: { shown: IMAGE },
        });
        rerender({ shown: OTHER });
        await waitFor(() => expect(result.current).toMatchObject({ status: "ready", path: "~/b.jpg" }));

        slow.resolve(info(IMAGE));
        await Promise.resolve();

        expect(result.current).toMatchObject({ status: "ready", path: "~/b.jpg" });
    });

    it("is loading at once after switching files", async () => {
        const { result, rerender } = renderHook(({ shown }) => useFileDetails(shown), {
            initialProps: { shown: IMAGE },
        });
        await waitFor(() => expect(result.current.status).toBe("ready"));

        mockedProbe.mockReturnValue(new Promise(() => {}));
        rerender({ shown: OTHER });

        expect(result.current).toEqual({ status: "loading" });
    });
});
