import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { trashMedia } from "./trash";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as Mock;

beforeEach(() => {
    mockedInvoke.mockReset();
});

describe("trashMedia", () => {
    it("sends the identities to trash_media", async () => {
        mockedInvoke.mockResolvedValue([]);

        await trashMedia(["aaaa", "bbbb"]);

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("trash_media", { identities: ["aaaa", "bbbb"] });
    });

    it("keeps both outcome shapes in order", async () => {
        const outcomes = [
            { status: "trashed" },
            { status: "failed", reason: "changed", message: "it has changed since it was opened" },
        ];
        mockedInvoke.mockResolvedValue(outcomes);

        await expect(trashMedia(["a", "b"])).resolves.toEqual(outcomes);
    });

    it.each([
        [JSON.parse("null")],
        ["trashed"],
        [{ status: "deleted" }],
        [{ status: "failed", reason: "bogus", message: "x" }],
        [{ status: "failed", reason: "trash" }],
    ])("turns the malformed %o into a failure", async (item) => {
        mockedInvoke.mockResolvedValue([item]);

        const [outcome] = await trashMedia(["a"]);

        expect(outcome).toEqual({ status: "failed", reason: "trash", message: expect.any(String) });
    });

    it("keeps only the fields of an outcome's status", async () => {
        mockedInvoke.mockResolvedValue([{ status: "trashed", message: "extra" }]);

        await expect(trashMedia(["a"])).resolves.toStrictEqual([{ status: "trashed" }]);
    });

    it("rejects when the command does", async () => {
        mockedInvoke.mockRejectedValue("the Trash task did not finish");

        await expect(trashMedia(["a"])).rejects.toBe("the Trash task did not finish");
    });
});
