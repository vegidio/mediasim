import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { isMacOs } from "@/ipc/os";
import { useScreenStore } from "@/stores/screen";
import { Header } from "./Header";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));

const onMacOs = isMacOs as Mock;

describe("Header", () => {
    beforeEach(() => {
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("shows the logo name, the step indicator and Settings", () => {
        render(<Header current="select" />);

        expect(screen.getByText("MediaSim")).toBeInTheDocument();
        expect(screen.getByRole("navigation", { name: "Progress" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    });

    it("is the window's drag region", () => {
        render(<Header current="select" />);

        expect(screen.getByRole("banner")).toHaveAttribute("data-tauri-drag-region", "deep");
    });

    it("opens Settings from the Settings button", () => {
        render(<Header current="select" />);
        const settings = screen.getByRole("button", { name: "Settings" });
        expect(settings).toBeEnabled();
        expect(settings).not.toHaveAttribute("aria-current");

        fireEvent.click(settings);

        expect(useScreenStore.getState().screen).toBe("settings");
    });

    it("shows Settings as the current page on the Settings screen, where it does nothing", () => {
        useScreenStore.getState().show("pair");
        useScreenStore.getState().openSettings();
        render(<Header title="Settings" />);
        const settings = screen.getByRole("button", { name: "Settings" });

        fireEvent.click(settings);

        expect(settings).toHaveAttribute("aria-current", "page");
        expect(settings).toBeEnabled();
        expect(screen.getByRole("banner")).toHaveTextContent("Settings");
        expect(useScreenStore.getState()).toMatchObject({ screen: "settings", returnTo: "pair" });
    });

    it("leaves room for the traffic lights on macOS", () => {
        onMacOs.mockReturnValue(true);
        render(<Header current="select" />);

        expect(screen.getByTestId("traffic-light-inset")).toBeInTheDocument();
    });

    it("shows a title in place of the step indicator, keeping the logo and Settings", () => {
        render(<Header title="Compare two files" />);

        const header = screen.getByRole("banner");
        expect(header).toHaveTextContent("Compare two files");
        expect(screen.queryByRole("navigation", { name: "Progress" })).not.toBeInTheDocument();
        expect(screen.getByText("MediaSim")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Settings" })).toBeEnabled();
    });

    it("starts flush at the leading edge elsewhere", () => {
        onMacOs.mockReturnValue(false);
        render(<Header current="select" />);

        expect(screen.queryByTestId("traffic-light-inset")).not.toBeInTheDocument();
    });
});
