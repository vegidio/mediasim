import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { describeMedia, renditionUrl } from "./thumbs";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
    // The macOS and Linux form; Windows gives `http://<scheme>.localhost/<path>`.
    convertFileSrc: vi.fn((path: string, scheme: string) => `${scheme}://localhost/${encodeURIComponent(path)}`),
}));

const mockedInvoke = invoke as Mock;
const mockedConvertFileSrc = convertFileSrc as Mock;

describe("describeMedia", () => {
    const image = { path: "/a.png", name: "a.png", type: "image", size: 10, identity: "0123456789abcdef" };
    const video = { path: "/b.mp4", name: "b.mp4", type: "video", size: 20, identity: "fedcba9876543210" };

    beforeEach(() => {
        mockedInvoke.mockReset();
    });

    it("sends the paths and keeps the order", async () => {
        mockedInvoke.mockResolvedValue([image, video]);

        await expect(describeMedia(["/a.png", "/b.mp4"])).resolves.toEqual([image, video]);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("describe_media", { paths: ["/a.png", "/b.mp4"] });
    });

    it("turns a path that can't be described into undefined", async () => {
        mockedInvoke.mockResolvedValue([image, JSON.parse("null"), video]);

        const files = await describeMedia(["/a.png", "/notes.txt", "/b.mp4"]);

        expect(files).toEqual([image, undefined, video]);
        expect(files[1]).toBeUndefined();
    });
});

describe("renditionUrl", () => {
    it("names the identity on the thumb scheme with the bound as size", () => {
        expect(renditionUrl("0123456789abcdef", 384)).toBe("thumb://localhost/0123456789abcdef?size=384");
        expect(mockedConvertFileSrc).toHaveBeenLastCalledWith("0123456789abcdef", "thumb");
    });
});
