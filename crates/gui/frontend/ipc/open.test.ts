import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { openMedia, revealMedia } from "./open";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as Mock;

beforeEach(() => {
    mockedInvoke.mockReset();
});

describe.each([
    ["openMedia", openMedia, "open_media"],
    ["revealMedia", revealMedia, "reveal_media"],
] as const)("%s", (_, action, command) => {
    it("sends the identity", async () => {
        mockedInvoke.mockResolvedValue(null);

        await expect(action("0123456789abcdef")).resolves.toBeNull();
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith(command, { identity: "0123456789abcdef" });
    });

    it.each([
        [{ kind: "unknown", message: "it wasn't opened in this window" }],
        [{ kind: "missing", message: "it no longer exists" }],
        [{ kind: "changed", message: "it has changed since it was opened" }],
        [{ kind: "failed", message: "no application" }],
        [{ kind: "task", message: "the background task did not finish" }],
    ])("rejects with the %o failure", async (failure) => {
        mockedInvoke.mockRejectedValue(failure);

        await expect(action("0123456789abcdef")).rejects.toEqual(failure);
    });

    it("turns any other rejection into a task failure", async () => {
        mockedInvoke.mockRejectedValue("Command not found");

        await expect(action("0123456789abcdef")).rejects.toEqual({ kind: "task", message: "Command not found" });
    });
});
