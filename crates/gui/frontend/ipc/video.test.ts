import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { probeVideo, type RemuxError, remuxClose, remuxNext, remuxOpen, videoUrl } from "./video";

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: vi.fn((path: string, scheme: string) => `${scheme}://localhost/${encodeURIComponent(path)}`),
    invoke: vi.fn(),
}));

const mockedConvertFileSrc = convertFileSrc as Mock;
const mockedInvoke = invoke as Mock;

const ID = "0123456789abcdef";

beforeEach(() => {
    mockedInvoke.mockReset();
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

describe("remux commands", () => {
    it("probes by identity", async () => {
        const probe = { format: "matroska,webm", duration: 42, video: { codec: "h264", codecString: "avc1.640028" } };
        mockedInvoke.mockResolvedValue(probe);

        await expect(probeVideo(ID)).resolves.toEqual(probe);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("probe_video", { identity: ID });
    });

    it("opens a session at a time, with or without audio", async () => {
        mockedInvoke.mockResolvedValue({ session: 3, start: 30 });

        await expect(remuxOpen(ID, 31, false)).resolves.toEqual({ session: 3, start: 30 });
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("remux_open", { identity: ID, at: 31, audio: false });
    });

    it("resolves the next segment to its raw bytes", async () => {
        const segment = new ArrayBuffer(8);
        mockedInvoke.mockResolvedValue(segment);

        await expect(remuxNext(3)).resolves.toBe(segment);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("remux_next", { session: 3 });
    });

    it("closes a session", async () => {
        mockedInvoke.mockResolvedValue(undefined);

        await remuxClose(3);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("remux_close", { session: 3 });
    });

    it.each<[unknown, RemuxError]>([
        [{ kind: "notfound" }, { kind: "notfound" }],
        [{ kind: "gone" }, { kind: "gone" }],
        [
            { kind: "unreadable", message: "bad file" },
            { kind: "unreadable", message: "bad file" },
        ],
        ["command remux_next not found", { kind: "unreadable", message: "command remux_next not found" }],
    ])("rejects %j as a refusal that narrows by kind", async (rejection, expected) => {
        mockedInvoke.mockRejectedValue(rejection);

        const error = await remuxNext(3).catch((error: RemuxError) => error);

        expect(error).toEqual(expected);
    });
});
