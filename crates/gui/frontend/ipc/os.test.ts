import { platform } from "@tauri-apps/plugin-os";
import { describe, expect, it, type Mock, vi } from "vitest";
import { isMacOs, isWindows } from "./os";

vi.mock("@tauri-apps/plugin-os", () => ({ platform: vi.fn() }));

const mockedPlatform = platform as Mock;

describe("isMacOs", () => {
    it("is true on macOS", () => {
        mockedPlatform.mockReturnValue("macos");

        expect(isMacOs()).toBe(true);
    });

    it("is false everywhere else", () => {
        for (const other of ["windows", "linux"]) {
            mockedPlatform.mockReturnValue(other);

            expect(isMacOs()).toBe(false);
        }
    });
});

describe("isWindows", () => {
    it("is true on Windows", () => {
        mockedPlatform.mockReturnValue("windows");

        expect(isWindows()).toBe(true);
    });

    it("is false everywhere else", () => {
        for (const other of ["macos", "linux"]) {
            mockedPlatform.mockReturnValue(other);

            expect(isWindows()).toBe(false);
        }
    });
});
