import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenStore } from "@/stores/screen";
import App from "./App";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));

describe("App", () => {
    beforeEach(() => {
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("renders the header", () => {
        render(<App />);

        const header = screen.getByRole("banner");
        expect(within(header).getByText("MediaSim")).toBeInTheDocument();
        expect(within(header).getByRole("navigation", { name: "Progress" })).toBeInTheDocument();
    });

    it("lands on the start screen", () => {
        render(<App />);

        const main = screen.getByRole("main");
        expect(
            within(main).getByRole("heading", { level: 1, name: "What do you want to compare?" }),
        ).toBeInTheDocument();
        expect(main).toHaveTextContent("Pick a mode, then drop your media onto its drop area — or click it to browse.");
        expect(within(main).getByRole("region", { name: "Compare two files" })).toBeInTheDocument();
        expect(within(main).getByRole("region", { name: "Find similar in a set" })).toBeInTheDocument();
        expect(main).toHaveTextContent("Images:");
    });

    it("marks Select as the current step on the start screen", () => {
        render(<App />);

        const progress = screen.getByRole("navigation", { name: "Progress" });
        expect(within(progress).getByText("Select").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
    });

    it("shows the pair screen's title in place of the steps, with the logo and Settings", () => {
        render(<App />);
        act(() => useScreenStore.getState().show("pair"));

        const header = screen.getByRole("banner");
        expect(header).toHaveTextContent("Compare two files");
        expect(within(header).queryByRole("navigation", { name: "Progress" })).not.toBeInTheDocument();
        expect(within(header).getByText("MediaSim")).toBeInTheDocument();
        expect(within(header).getByRole("button", { name: "Settings" })).toBeDisabled();
        expect(screen.queryByRole("heading", { name: "What do you want to compare?" })).not.toBeInTheDocument();
    });
});
