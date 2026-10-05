import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, type Mock, vi } from "vitest";
import { addToSet, removeFromSet, rescanSet, type SetView } from "./set";

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
});
