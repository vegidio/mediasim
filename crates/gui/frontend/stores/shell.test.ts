import { beforeEach, describe, expect, it } from "vitest";
import { useShellStore } from "@/stores/shell";

describe("useShellStore", () => {
    beforeEach(() => {
        useShellStore.setState(useShellStore.getInitialState(), true);
    });

    it("starts with the sidebar open", () => {
        expect(useShellStore.getState().sidebarOpen).toBe(true);
    });

    it("toggles the sidebar", () => {
        useShellStore.getState().toggleSidebar();
        expect(useShellStore.getState().sidebarOpen).toBe(false);

        useShellStore.getState().toggleSidebar();
        expect(useShellStore.getState().sidebarOpen).toBe(true);
    });

    it("sets the sidebar explicitly", () => {
        useShellStore.getState().setSidebarOpen(false);
        expect(useShellStore.getState().sidebarOpen).toBe(false);
    });
});
