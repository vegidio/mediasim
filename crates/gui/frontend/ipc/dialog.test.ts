import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { pickFile, pickFiles, pickFolders } from "./dialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as Mock;

beforeEach(() => {
    mockedInvoke.mockReset();
});

describe("pickFiles", () => {
    it("filters on every extension in both cases and returns the picked files", async () => {
        mockedInvoke.mockResolvedValue(["/a.jpg", "/b.MOV"]);

        const picked = await pickFiles([
            { type: "image", extensions: ["jpg", "jpeg"] },
            { type: "video", extensions: ["mov"] },
        ]);

        expect(picked).toEqual(["/a.jpg", "/b.MOV"]);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("pick_files", {
            filters: [{ name: "Images and videos", extensions: ["jpg", "JPG", "jpeg", "JPEG", "mov", "MOV"] }],
        });
    });

    it("returns nothing when cancelled", async () => {
        mockedInvoke.mockResolvedValue([]);

        await expect(pickFiles([])).resolves.toEqual([]);
    });

    it("rejects when the command does", async () => {
        mockedInvoke.mockRejectedValue("the background task did not finish");

        await expect(pickFiles([])).rejects.toBe("the background task did not finish");
    });
});

describe("pickFile", () => {
    it("opens a single-file picker with the same filter and returns the picked file", async () => {
        mockedInvoke.mockResolvedValue("/a.JPG");

        const picked = await pickFile([
            { type: "image", extensions: ["jpg"] },
            { type: "video", extensions: ["mov"] },
        ]);

        expect(picked).toBe("/a.JPG");
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("pick_file", {
            filters: [{ name: "Images and videos", extensions: ["jpg", "JPG", "mov", "MOV"] }],
        });
    });

    it("returns undefined when cancelled", async () => {
        mockedInvoke.mockResolvedValue(JSON.parse("null"));

        await expect(pickFile([])).resolves.toBeUndefined();
    });
});

describe("pickFolders", () => {
    it("opens a multi-select folder picker and returns the picked folders", async () => {
        mockedInvoke.mockResolvedValue(["/x", "/y"]);

        await expect(pickFolders()).resolves.toEqual(["/x", "/y"]);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("pick_folders");
    });

    it("returns nothing when cancelled", async () => {
        mockedInvoke.mockResolvedValue([]);

        await expect(pickFolders()).resolves.toEqual([]);
    });
});
