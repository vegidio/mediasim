import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));

describe("App", () => {
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
});
