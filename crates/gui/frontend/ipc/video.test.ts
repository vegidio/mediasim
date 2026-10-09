import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { forgetVideoProbes, probeVideo, type VideoError, videoClose, videoNext, videoOpen, videoUrl } from "./video";

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: vi.fn((path: string, scheme: string) => `${scheme}://localhost/${encodeURIComponent(path)}`),
    invoke: vi.fn(),
}));

const mockedConvertFileSrc = convertFileSrc as Mock;
const mockedInvoke = invoke as Mock;

const ID = "0123456789abcdef";

beforeEach(() => {
    mockedInvoke.mockReset();
    forgetVideoProbes();
});

describe("videoUrl", () => {
    it("names the identity on the video scheme, in the platform's form", () => {
        expect(videoUrl(ID)).toBe("video://localhost/0123456789abcdef");
        expect(mockedConvertFileSrc).toHaveBeenLastCalledWith(ID, "video");
    });

    it("uses the Windows form when the platform does", () => {
        mockedConvertFileSrc.mockImplementationOnce(
            (path: string, scheme: string) => `http://${scheme}.localhost/${path}`,
        );

        expect(videoUrl(ID)).toBe("http://video.localhost/0123456789abcdef");
    });
});

describe("video commands", () => {
    it("probes by identity", async () => {
        const probe = {
            format: "matroska,webm",
            duration: 42,
            video: { codec: "h264", codecString: "avc1.640028", decodable: true },
            audio: { codec: "dts", decodable: true, sampleRate: 48000 },
        };
        mockedInvoke.mockResolvedValue(probe);

        const probed = await probeVideo(ID);

        expect(probed).toEqual(probe);
        expect(probed.audio?.sampleRate).toBe(48000);
        expect(probed.video?.sampleRate).toBeUndefined();
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("probe_video", { identity: ID });
    });

    it("probes each identity once, sharing the probe with every later call", async () => {
        mockedInvoke.mockResolvedValue({ format: "mp4", duration: 1 });

        const first = probeVideo(ID);
        await first;

        expect(probeVideo(ID)).toBe(first);
        await probeVideo("another");
        expect(mockedInvoke.mock.calls).toEqual([
            ["probe_video", { identity: ID }],
            ["probe_video", { identity: "another" }],
        ]);
    });

    it("probes again after a failure, keeping only the probe that succeeded", async () => {
        mockedInvoke.mockRejectedValueOnce({ kind: "unreadable", message: "busy" });
        mockedInvoke.mockResolvedValueOnce({ format: "mp4", duration: 1 });

        await expect(probeVideo(ID)).rejects.toEqual({ kind: "unreadable", message: "busy" });
        await expect(probeVideo(ID)).resolves.toEqual({ format: "mp4", duration: 1 });
        await probeVideo(ID);

        expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });

    it("opens a session at a time, with a mode for each stream", async () => {
        mockedInvoke.mockResolvedValue({ session: 3, start: 30 });

        await expect(videoOpen(ID, 31, { video: "encode", audio: "none" })).resolves.toEqual({ session: 3, start: 30 });
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("video_open", {
            identity: ID,
            at: 31,
            video: "encode",
            audio: "none",
        });
    });

    it("passes copied video with encoded sound as they are", async () => {
        mockedInvoke.mockResolvedValue({ session: 4, start: 0 });

        await videoOpen(ID, 0, { video: "copy", audio: "encode" });
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("video_open", {
            identity: ID,
            at: 0,
            video: "copy",
            audio: "encode",
        });
    });

    it("resolves the next segment to its raw bytes", async () => {
        const segment = new ArrayBuffer(8);
        mockedInvoke.mockResolvedValue(segment);

        await expect(videoNext(3)).resolves.toBe(segment);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("video_next", { session: 3 });
    });

    it("closes a session", async () => {
        mockedInvoke.mockResolvedValue(undefined);

        await videoClose(3);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("video_close", { session: 3 });
    });

    it.each<[unknown, VideoError]>([
        [{ kind: "notfound" }, { kind: "notfound" }],
        [{ kind: "gone" }, { kind: "gone" }],
        [
            { kind: "unreadable", message: "bad file" },
            { kind: "unreadable", message: "bad file" },
        ],
        [
            { kind: "task", message: "the background task did not finish" },
            { kind: "task", message: "the background task did not finish" },
        ],
        ["command video_next not found", { kind: "task", message: "command video_next not found" }],
    ])("rejects %j as a refusal that narrows by kind", async (rejection, expected) => {
        mockedInvoke.mockRejectedValue(rejection);

        const error = await videoNext(3).catch((error: VideoError) => error);

        expect(error).toEqual(expected);
    });
});
