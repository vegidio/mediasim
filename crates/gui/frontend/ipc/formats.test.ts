import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as Mock;

// The module caches its answer, so each test imports a fresh copy.
const load = async () => (await import("./formats")).supportedFormats;

describe("supportedFormats", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("asks Rust once and shares the answer", async () => {
        const formats = [{ type: "image", extensions: ["jpg", "jpeg"] }];
        mockedInvoke.mockResolvedValue(formats);
        const supportedFormats = await load();

        await expect(supportedFormats()).resolves.toEqual(formats);
        await expect(supportedFormats()).resolves.toEqual(formats);

        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith("supported_formats");
    });

    it("asks again after a failed request", async () => {
        mockedInvoke.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]);
        const supportedFormats = await load();

        await expect(supportedFormats()).rejects.toThrow("boom");
        await expect(supportedFormats()).resolves.toEqual([]);

        expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });
});
