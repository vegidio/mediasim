import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useShellStore } from "@/stores/shell";
import App from "./App";

describe("App", () => {
    beforeEach(() => {
        useShellStore.setState(useShellStore.getInitialState(), true);
    });

    it("renders the empty shell", () => {
        render(<App />);

        expect(screen.getByRole("heading", { name: "MediaSim" })).toBeInTheDocument();
        expect(screen.getByRole("main")).toHaveTextContent("No media to compare yet.");
        expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeInTheDocument();
    });

    it("hides and shows the sidebar from the toolbar", () => {
        render(<App />);

        fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
        expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
        expect(useShellStore.getState().sidebarOpen).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
        expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeInTheDocument();
    });
});
