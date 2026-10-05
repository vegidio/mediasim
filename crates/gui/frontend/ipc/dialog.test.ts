import { open } from "@tauri-apps/plugin-dialog";
import { describe, expect, it, type Mock, vi } from "vitest";
import { pickFile, pickFiles, pickFolders } from "./dialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const mockedOpen = open as Mock;

describe("pickFiles", () => {
    it("filters on every extension in both cases and returns the picked files", async () => {
        mockedOpen.mockResolvedValue(["/a.jpg", "/b.MOV"]);

        const picked = await pickFiles([
            { type: "image", extensions: ["jpg", "jpeg"] },
            { type: "video", extensions: ["mov"] },
        ]);

        expect(picked).toEqual(["/a.jpg", "/b.MOV"]);
        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith({
            multiple: true,
            directory: false,
            filters: [{ name: "Images and videos", extensions: ["jpg", "JPG", "jpeg", "JPEG", "mov", "MOV"] }],
        });
    });

    it("returns nothing when cancelled", async () => {
        mockedOpen.mockResolvedValue(null);

        await expect(pickFiles([])).resolves.toEqual([]);
    });
});

describe("pickFile", () => {
    it("opens a single-file picker with the same filter and returns the picked file", async () => {
        mockedOpen.mockResolvedValue("/a.JPG");

        const picked = await pickFile([
            { type: "image", extensions: ["jpg"] },
            { type: "video", extensions: ["mov"] },
        ]);

        expect(picked).toBe("/a.JPG");
        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith({
            multiple: false,
            directory: false,
            filters: [{ name: "Images and videos", extensions: ["jpg", "JPG", "mov", "MOV"] }],
        });
    });

    it("returns undefined when cancelled", async () => {
        mockedOpen.mockResolvedValue(null);

        await expect(pickFile([])).resolves.toBeUndefined();
    });
});

describe("pickFolders", () => {
    it("opens a multi-select folder picker and returns the picked folders", async () => {
        mockedOpen.mockResolvedValue(["/x", "/y"]);

        await expect(pickFolders()).resolves.toEqual(["/x", "/y"]);
        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith({ multiple: true, directory: true });
    });

    it("returns nothing when cancelled", async () => {
        mockedOpen.mockResolvedValue(null);

        await expect(pickFolders()).resolves.toEqual([]);
    });
});
