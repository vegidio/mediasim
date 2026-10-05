import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { cancelComparison, comparePair, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { usePairStore } from "@/stores/pair";
import { usePairResultStore } from "@/stores/pairResult";
import { usePairViewStore } from "@/stores/pairView";
import { useScreenStore } from "@/stores/screen";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/thumbs", () => ({
    describeMedia: vi.fn(),
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));

const mockedProbe = probeMedia as Mock;
const mockedCompare = comparePair as Mock;
const mockedCancel = cancelComparison as Mock;

const media = (name: string, type: MediaType = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

const A = media("IMG_2041.jpg");
const B = media("IMG_2041-edit.jpg");

const compare = () => screen.getByRole("button", { name: "Compare" });
const back = () => screen.getByRole("button", { name: "New comparison" });
const tab = (name: string) => screen.getByRole("tab", { name });
const handle = () => screen.getByRole("slider", { name: "Drag to compare A and B" });
const panes = () => screen.getAllByRole("article").map((pane) => pane.getAttribute("aria-label"));

/** Selects a view-mode tab the way a click does: Radix tabs activate on mouse down. */
const select = (name: string) => fireEvent.mouseDown(tab(name));

/** A promise the test settles when it chooses. */
const deferred = <T,>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

/** Lets every settled promise's callbacks run, inside `act` so React renders their results. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("PairResultScreen", () => {
    beforeEach(() => {
        usePairStore.setState(usePairStore.getInitialState(), true);
        usePairResultStore.setState(usePairResultStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
        usePairViewStore.setState(usePairViewStore.getInitialState(), true);
        mockedProbe.mockReset().mockReturnValue(new Promise(() => {}));
        mockedCompare.mockReset().mockReturnValue(new Promise(() => {}));
        mockedCancel.mockReset().mockResolvedValue(undefined);
    });

    it("opens from Compare with A on the left, comparing, and focus on New comparison", () => {
        usePairStore.setState({ a: A, b: B });
        render(<App />);

        fireEvent.click(compare());

        const panes = screen.getAllByRole("article");
        expect(panes.map((pane) => pane.getAttribute("aria-label"))).toEqual(["File A", "File B"]);
        expect(within(panes[0] as HTMLElement).getByText("IMG_2041.jpg")).toBeInTheDocument();
        expect(within(panes[1] as HTMLElement).getByText("IMG_2041-edit.jpg")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Comparing…");
        expect(screen.getByRole("banner")).toHaveTextContent("Compare two files");
        expect(mockedCompare).toHaveBeenCalledExactlyOnceWith(A.path, B.path);
        expect(back()).toHaveFocus();
    });

    it("shows the score once the comparison finishes", async () => {
        mockedCompare.mockResolvedValue(0.94522);
        usePairStore.setState({ a: A, b: B });
        render(<App />);

        fireEvent.click(compare());
        await settle();

        const result = screen.getByRole("region", { name: "Similarity result" });
        expect(result).toHaveTextContent("95%");
        expect(result).toHaveTextContent("Near identical");
    });

    it("retries a failed comparison", async () => {
        mockedCompare.mockRejectedValueOnce({ kind: "load", path: B.path, message: "failed to load image" });
        usePairStore.setState({ a: A, b: B });
        render(<App />);
        fireEvent.click(compare());
        await settle();

        fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));

        expect(screen.getByRole("status")).toHaveTextContent("Comparing…");
        expect(mockedCompare).toHaveBeenCalledTimes(2);
    });

    it("returns to the start screen with both slots filled, and Compare enabled and focused", () => {
        usePairStore.setState({ a: A, b: B });
        render(<App />);
        fireEvent.click(compare());

        fireEvent.click(back());

        expect(screen.getByRole("heading", { name: "What do you want to compare?" })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "File A" })).toHaveTextContent("IMG_2041.jpg");
        expect(screen.getByRole("group", { name: "File B" })).toHaveTextContent("IMG_2041-edit.jpg");
        expect(compare()).toBeEnabled();
        expect(compare()).toHaveFocus();
        expect(mockedCancel).toHaveBeenCalledOnce();
    });

    it("shows a replaced File B when comparing again", () => {
        const C = media("other.jpg");
        usePairStore.setState({ a: A, b: B });
        render(<App />);
        fireEvent.click(compare());
        fireEvent.click(back());

        act(() => usePairStore.setState({ b: C }));
        fireEvent.click(compare());

        expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent("other.jpg");
        expect(screen.getByRole("status")).toHaveTextContent("Comparing…");
        expect(mockedCompare).toHaveBeenLastCalledWith(A.path, C.path);
    });

    it("takes focus back to Compare only once after returning", () => {
        usePairStore.setState({ a: A, b: B });
        const { unmount } = render(<App />);
        fireEvent.click(compare());
        fireEvent.click(back());
        expect(compare()).toHaveFocus();
        unmount();

        render(<App />);

        expect(compare()).not.toHaveFocus();
    });

    it("does not take focus back to Compare on a first visit", () => {
        usePairStore.setState({ a: A, b: B });
        render(<App />);

        expect(compare()).not.toHaveFocus();
    });

    describe("view mode", () => {
        it("opens the first pair side by side", () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);

            fireEvent.click(compare());

            expect(screen.getByRole("tablist", { name: "View mode" })).toBeInTheDocument();
            expect(tab("Side by side")).toHaveAttribute("aria-selected", "true");
            expect(tab("Slider")).toHaveAttribute("aria-selected", "false");
            expect(panes()).toEqual(["File A", "File B"]);
        });

        it("swaps the panes for the slider while comparing, and still shows the result", async () => {
            const comparison = deferred<number>();
            mockedCompare.mockReturnValue(comparison.promise);
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());

            select("Slider");

            expect(tab("Slider")).toHaveAttribute("aria-selected", "true");
            expect(panes()).toEqual(["Files A and B"]);
            expect(handle()).toBeInTheDocument();
            expect(screen.getByRole("status")).toHaveTextContent("Comparing…");
            expect(mockedCompare).toHaveBeenCalledOnce();

            comparison.resolve(0.94522);
            await settle();

            expect(screen.getByRole("region", { name: "Similarity result" })).toHaveTextContent("95%");
        });

        it("selects the slider with the right arrow key", async () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            tab("Side by side").focus();

            fireEvent.keyDown(tab("Side by side"), { key: "ArrowRight" });

            // Radix's roving focus moves focus, and so selects, on the next task.
            await waitFor(() => expect(tab("Slider")).toHaveFocus());
            expect(tab("Slider")).toHaveAttribute("aria-selected", "true");
            expect(panes()).toEqual(["Files A and B"]);
        });

        it("switches views after the comparison failed", async () => {
            mockedCompare.mockRejectedValue({ kind: "load", path: B.path, message: "failed to load image" });
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            await settle();

            select("Slider");

            expect(panes()).toEqual(["Files A and B"]);
            expect(screen.getByRole("alert")).toBeInTheDocument();

            select("Side by side");

            expect(panes()).toEqual(["File A", "File B"]);
        });

        it("keeps the mode for the next pair, with focus on New comparison", () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            select("Slider");

            fireEvent.click(back());
            fireEvent.click(compare());

            expect(tab("Slider")).toHaveAttribute("aria-selected", "true");
            expect(panes()).toEqual(["Files A and B"]);
            expect(back()).toHaveFocus();
        });
    });

    describe("slider handle", () => {
        it("starts in the middle, keeps its place across views, and resets for a new pair", () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            select("Slider");
            expect(handle()).toHaveAttribute("aria-valuenow", "50");

            fireEvent.keyDown(handle(), { key: "Home" });
            for (let i = 0; i < 3; i++) fireEvent.keyDown(handle(), { key: "PageUp" });
            expect(handle()).toHaveAttribute("aria-valuenow", "30");

            select("Side by side");
            select("Slider");

            expect(handle()).toHaveAttribute("aria-valuenow", "30");

            fireEvent.click(back());
            fireEvent.click(compare());

            expect(handle()).toHaveAttribute("aria-valuenow", "50");
        });
    });
});
