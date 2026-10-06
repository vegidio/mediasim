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

    describe("deletion footer", () => {
        const footer = () => screen.queryByRole("region", { name: "Deletion" });

        it("is absent on the start screen", () => {
            render(<App />);

            expect(footer()).not.toBeInTheDocument();
        });

        it("sits below main on the pair screen, not inside it, as a fixed-height bar", () => {
            render(<App />);
            act(() => useScreenStore.getState().show("pair"));

            const main = screen.getByRole("main");
            expect(footer()).toBeInTheDocument();
            expect(main).not.toContainElement(footer());
            // Below the box that holds main and the notice floating over it.
            expect(main.parentElement?.nextElementSibling).toBe(footer());
            expect(footer()).toHaveClass("shrink-0", "h-[68px]");
            expect(main).toHaveClass("flex-1", "overflow-y-auto");
        });

        it("leaves with the pair screen", () => {
            render(<App />);
            act(() => useScreenStore.getState().show("pair"));

            act(() => useScreenStore.getState().show("start"));

            expect(footer()).not.toBeInTheDocument();
        });
    });

    describe("deletion notice", () => {
        /** The notice's status region, the one outside both main and the footer. */
        const notice = () =>
            screen
                .queryAllByRole("status")
                .find(
                    (region) =>
                        !screen.getByRole("main").contains(region) &&
                        !screen.queryByRole("region", { name: "Deletion" })?.contains(region),
                );

        it("is absent on the start screen", () => {
            render(<App />);

            expect(notice()).toBeUndefined();
        });

        it("floats 20 px above the footer, centred over main's box, outside main and the footer", () => {
            render(<App />);
            act(() => useScreenStore.getState().show("pair"));

            const main = screen.getByRole("main");
            const region = notice() as HTMLElement;
            expect(region).toBeInTheDocument();
            expect(region.parentElement).toBe(main.parentElement);
            expect(main.parentElement).toHaveClass("relative");
            expect(region).toHaveClass("absolute", "bottom-5", "left-1/2", "-translate-x-1/2");
        });
    });
});
