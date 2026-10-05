import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, type Mock, vi } from "vitest";
import { windowReady } from "./window";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("windowReady", () => {
    it("calls the command Rust registers, with no arguments", () => {
        windowReady();

        expect(invoke as Mock).toHaveBeenCalledExactlyOnceWith("window_ready");
    });
});
