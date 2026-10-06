import { convertFileSrc } from "@tauri-apps/api/core";
import { describe, expect, it, type Mock, vi } from "vitest";
import { videoUrl } from "./video";

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: vi.fn((path: string, scheme: string) => `${scheme}://localhost/${encodeURIComponent(path)}`),
}));

const mockedConvertFileSrc = convertFileSrc as Mock;

describe("videoUrl", () => {
    it("names the identity on the video scheme, in the platform's form", () => {
        expect(videoUrl("0123456789abcdef")).toBe("video://localhost/0123456789abcdef");
        expect(mockedConvertFileSrc).toHaveBeenLastCalledWith("0123456789abcdef", "video");
    });

    it("uses the Windows form when the platform does", () => {
        mockedConvertFileSrc.mockImplementationOnce(
            (path: string, scheme: string) => `http://${scheme}.localhost/${path}`,
        );

        expect(videoUrl("0123456789abcdef")).toBe("http://video.localhost/0123456789abcdef");
    });
});
