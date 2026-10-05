import { render, screen } from "@testing-library/react";
import { describe, expect, it, type Mock, vi } from "vitest";
import { isMacOs } from "@/ipc/os";
import { Header } from "./Header";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));

const onMacOs = isMacOs as Mock;

describe("Header", () => {
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

    it("has Settings disabled", () => {
        render(<Header current="select" />);

        expect(screen.getByRole("button", { name: "Settings" })).toBeDisabled();
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
        expect(screen.getByRole("button", { name: "Settings" })).toBeDisabled();
    });

    it("starts flush at the leading edge elsewhere", () => {
        onMacOs.mockReturnValue(false);
        render(<Header current="select" />);

        expect(screen.queryByTestId("traffic-light-inset")).not.toBeInTheDocument();
    });
});
