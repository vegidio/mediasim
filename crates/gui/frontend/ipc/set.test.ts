import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, type Mock, vi } from "vitest";
import { addToSet, displayPath, listSetMedia, removeFromSet, rescanSet, type SetMedia, type SetView } from "./set";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as Mock;
const view: SetView = { revision: 1, sources: [], total: 0 };

describe("set commands", () => {
    it("adds paths with the subfolder setting", async () => {
        mockedInvoke.mockResolvedValue(view);

        await expect(addToSet(["/a", "/b.jpg"], true)).resolves.toBe(view);

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("add_to_set", {
            paths: ["/a", "/b.jpg"],
            recursive: true,
        });
    });

    it("removes a path", async () => {
        mockedInvoke.mockResolvedValue(view);

        await expect(removeFromSet("/a")).resolves.toBe(view);

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("remove_from_set", { path: "/a" });
    });

    it("rescans with the new subfolder setting", async () => {
        mockedInvoke.mockResolvedValue(view);

        await expect(rescanSet(false)).resolves.toBe(view);

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("rescan_set", { recursive: false });
    });

    it("lists the set's media", async () => {
        const media: SetMedia = {
            revision: 3,
            files: [{ path: "/a/b.jpg", name: "b.jpg", type: "image", size: 4, identity: "0123456789abcdef" }],
        };
        mockedInvoke.mockResolvedValue(media);

        await expect(listSetMedia()).resolves.toBe(media);

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("list_set_media");
    });

    it("shows a path as the set list does", async () => {
        mockedInvoke.mockResolvedValue("~/Pictures/a.png");

        await expect(displayPath("/Users/me/Pictures/a.png")).resolves.toBe("~/Pictures/a.png");

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("display_path", { path: "/Users/me/Pictures/a.png" });
    });
});
