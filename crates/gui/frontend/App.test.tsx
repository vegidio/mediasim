import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { comparePair, probeMedia } from "@/ipc/pair";
import { listSetMedia } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { restoreMedia, trashMedia } from "@/ipc/trash";
import { useGalleryStore } from "@/stores/gallery";
import { usePairStore } from "@/stores/pair";
import { usePairResultStore } from "@/stores/pairResult";
import { useScreenStore } from "@/stores/screen";
import App from "./App";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/thumbs", () => ({
    describeMedia: vi.fn(),
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), restoreMedia: vi.fn(), deleteMedia: vi.fn() }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));

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

    describe("gallery", () => {
        beforeEach(() => {
            (listSetMedia as Mock).mockReturnValue(new Promise(() => {}));
            useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        });

        it("marks Select as the current step, with the toolbar outside a scrolling main", () => {
            render(<App />);
            act(() => useScreenStore.getState().show("gallery"));

            const progress = screen.getByRole("navigation", { name: "Progress" });
            expect(within(progress).getByText("Select").closest("[aria-current]")).toHaveAttribute(
                "aria-current",
                "step",
            );
            expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
            expect(screen.getByRole("main")).not.toHaveClass("overflow-y-auto");
        });

        it("opens Settings and goes Back to the gallery, with focus on the Settings button", async () => {
            render(<App />);
            act(() => useScreenStore.getState().show("gallery"));
            fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" }));
            expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "Back" }));

            expect(screen.getByRole("tablist", { name: "Filter media" })).toBeInTheDocument();
            await waitFor(() =>
                expect(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" })).toHaveFocus(),
            );
        });

        it("keeps the threshold across a trip to Settings that leaves the default alone", () => {
            render(<App />);
            act(() => useScreenStore.getState().show("gallery"));
            act(() => useGalleryStore.getState().setThreshold(72));
            expect(screen.getByText("72%")).toBeInTheDocument();

            fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Settings" }));
            fireEvent.click(screen.getByRole("button", { name: "Back" }));

            expect(screen.getByRole("slider", { name: "Match threshold" })).toHaveAttribute("aria-valuenow", "72");
            expect(screen.getByText("72%")).toBeInTheDocument();
        });
    });

    it("shows the pair screen's title in place of the steps, with the logo and Settings", () => {
        render(<App />);
        act(() => useScreenStore.getState().show("pair"));

        const header = screen.getByRole("banner");
        expect(header).toHaveTextContent("Compare two files");
        expect(within(header).queryByRole("navigation", { name: "Progress" })).not.toBeInTheDocument();
        expect(within(header).getByText("MediaSim")).toBeInTheDocument();
        expect(within(header).getByRole("button", { name: "Settings" })).toBeEnabled();
        expect(screen.queryByRole("heading", { name: "What do you want to compare?" })).not.toBeInTheDocument();
    });

    describe("Settings", () => {
        const settingsButton = () => within(screen.getByRole("banner")).getByRole("button", { name: "Settings" });
        const media = (name: string): MediaFile => ({
            path: `/media/${name}`,
            name,
            type: "image",
            size: 1000,
            identity: `id-${name}`,
        });
        const [a, b] = [media("a.jpg"), media("b.jpg")];

        beforeEach(() => {
            (probeMedia as Mock).mockReturnValue(new Promise(() => {}));
            (comparePair as Mock).mockReturnValue(new Promise(() => {}));
            usePairStore.setState(usePairStore.getInitialState(), true);
            usePairResultStore.setState(usePairResultStore.getInitialState(), true);
        });

        it("opens from the start screen, reading Settings in the header with the button as the current page", () => {
            render(<App />);

            fireEvent.click(settingsButton());

            const header = screen.getByRole("banner");
            expect(header).toHaveTextContent("Settings");
            expect(within(header).queryByRole("navigation", { name: "Progress" })).not.toBeInTheDocument();
            expect(settingsButton()).toHaveAttribute("aria-current", "page");
            expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
            expect(screen.getByRole("region", { name: "Deleting files" })).toBeInTheDocument();
        });

        it("goes Back to the start screen with its slots, and focus on the Settings button", async () => {
            usePairStore.setState({ a, b });
            render(<App />);
            fireEvent.click(settingsButton());

            fireEvent.click(screen.getByRole("button", { name: "Back" }));

            expect(screen.getByRole("heading", { level: 1, name: "What do you want to compare?" })).toBeInTheDocument();
            expect(usePairStore.getState()).toMatchObject({ a, b });
            expect(settingsButton()).not.toHaveAttribute("aria-current");
            await waitFor(() => expect(settingsButton()).toHaveFocus());
        });

        it("opens from a pair, hiding the footer and notice, and comes back to it unchanged", async () => {
            (trashMedia as Mock).mockResolvedValue([{ status: "trashed" }]);
            usePairStore.setState({ a, b });
            render(<App />);
            fireEvent.click(screen.getByRole("button", { name: "Compare" }));
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            fireEvent.click(screen.getByRole("button", { name: "Move 1 to Trash…" }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            // The move sends focus to Dismiss once the dialog has closed; let it land, so it can't race Back's focus.
            await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss" })).toHaveFocus());
            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));
            const before = usePairResultStore.getState();

            fireEvent.click(settingsButton());

            expect(screen.queryByRole("region", { name: "Deletion" })).not.toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
            expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "Back" }));

            expect(screen.getByRole("banner")).toHaveTextContent("Compare two files");
            expect(usePairResultStore.getState()).toBe(before);
            expect(screen.getByRole("button", { name: "Undo moving b.jpg to Trash" })).toBeInTheDocument();
            expect(within(screen.getByRole("region", { name: "Deletion" })).getByRole("status")).toHaveTextContent(
                "1 file marked for deletion",
            );
            expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
            await waitFor(() => expect(settingsButton()).toHaveFocus());
            expect(screen.getByRole("button", { name: "New comparison" })).not.toHaveFocus();
        });

        it("shows the score of a comparison that finished while in Settings", async () => {
            let finish: (similarity: number) => void = () => {};
            (comparePair as Mock).mockReturnValue(new Promise((resolve) => (finish = resolve)));
            usePairStore.setState({ a, b });
            render(<App />);
            fireEvent.click(screen.getByRole("button", { name: "Compare" }));
            fireEvent.click(settingsButton());

            await act(async () => finish(0.94522));
            fireEvent.click(screen.getByRole("button", { name: "Back" }));

            expect(screen.getByRole("region", { name: "Similarity result" })).toHaveTextContent("95%");
        });
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

        it("reports a restore in the same place, with the footer back to its first text", async () => {
            const media = (name: string): MediaFile => ({
                path: `/media/${name}`,
                name,
                type: "image",
                size: 1000,
                identity: `id-${name}`,
            });
            const [a, b] = [media("a.jpg"), media("b.jpg")];
            (probeMedia as Mock).mockReturnValue(new Promise(() => {}));
            (comparePair as Mock).mockReturnValue(new Promise(() => {}));
            (trashMedia as Mock).mockResolvedValue([{ status: "trashed" }]);
            (restoreMedia as Mock).mockResolvedValue([{ status: "restored", identity: b.identity }]);
            usePairStore.setState(usePairStore.getInitialState(), true);
            usePairResultStore.setState(usePairResultStore.getInitialState(), true);
            usePairStore.setState({ a, b });
            render(<App />);
            const footer = () => screen.getByRole("region", { name: "Deletion" });
            fireEvent.click(screen.getByRole("button", { name: "Compare" }));
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            fireEvent.click(within(footer()).getByRole("button", { name: "Move 1 to Trash…" }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

            fireEvent.click(screen.getByRole("button", { name: "Undo moving b.jpg to Trash" }));
            await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

            const main = screen.getByRole("main");
            expect(notice()).toHaveTextContent(/^1 file restored$/);
            expect(notice()?.parentElement).toBe(main.parentElement);
            expect(within(footer()).getByRole("status")).toHaveTextContent(
                "Nothing marked yet. Mark the file you don't need.",
            );
        });
    });
});
