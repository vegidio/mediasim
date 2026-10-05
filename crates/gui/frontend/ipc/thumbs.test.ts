import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { admitMedia, renditionUrl } from "./thumbs";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
    // The macOS and Linux form; Windows gives `http://<scheme>.localhost/<path>`.
    convertFileSrc: vi.fn((path: string, scheme: string) => `${scheme}://localhost/${encodeURIComponent(path)}`),
}));

const mockedInvoke = invoke as Mock;
const mockedConvertFileSrc = convertFileSrc as Mock;

describe("admitMedia", () => {
    beforeEach(() => {
        mockedInvoke.mockReset();
    });

    it("sends the paths and keeps the order", async () => {
        mockedInvoke.mockResolvedValue(["0123456789abcdef", "fedcba9876543210"]);

        await expect(admitMedia(["/a.png", "/b.mp4"])).resolves.toEqual(["0123456789abcdef", "fedcba9876543210"]);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("admit_media", { paths: ["/a.png", "/b.mp4"] });
    });

    it("turns a path without an identity into undefined", async () => {
        mockedInvoke.mockResolvedValue(["0123456789abcdef", JSON.parse("null"), "fedcba9876543210"]);

        const identities = await admitMedia(["/a.png", "/missing.png", "/b.mp4"]);

        expect(identities).toEqual(["0123456789abcdef", undefined, "fedcba9876543210"]);
        expect(identities[1]).toBeUndefined();
    });
});

describe("renditionUrl", () => {
    it("names the identity on the thumb scheme with the bound as size", () => {
        expect(renditionUrl("0123456789abcdef", 384)).toBe("thumb://localhost/0123456789abcdef?size=384");
        expect(mockedConvertFileSrc).toHaveBeenLastCalledWith("0123456789abcdef", "thumb");
    });
});
