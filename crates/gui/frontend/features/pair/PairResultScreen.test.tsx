import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { cancelComparison, comparePair, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { restoreMedia, trashMedia } from "@/ipc/trash";
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
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), restoreMedia: vi.fn() }));

const mockedProbe = probeMedia as Mock;
const mockedCompare = comparePair as Mock;
const mockedCancel = cancelComparison as Mock;
const mockedTrash = trashMedia as Mock;
const mockedRestore = restoreMedia as Mock;

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
/** The score panel's status; the deletion footer has its own. */
const scoreStatus = () => within(screen.getByRole("main")).getByRole("status");
const footer = () => screen.getByRole("region", { name: "Deletion" });
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
        expect(scoreStatus()).toHaveTextContent("Comparing…");
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

        expect(scoreStatus()).toHaveTextContent("Comparing…");
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
        expect(screen.queryByRole("region", { name: "Deletion" })).not.toBeInTheDocument();
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
        expect(scoreStatus()).toHaveTextContent("Comparing…");
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
            expect(scoreStatus()).toHaveTextContent("Comparing…");
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

    describe("marking for deletion", () => {
        it("marks B side by side, and keeps the mark in the slider with its tag", () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());

            fireEvent.click(
                within(screen.getByRole("article", { name: "File B" })).getByRole("button", {
                    name: "Mark B for deletion",
                }),
            );

            expect(screen.getByRole("button", { name: "B Marked · Undo" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Mark A for deletion" })).toBeInTheDocument();
            expect(within(footer()).getByRole("status")).toHaveTextContent("1 file marked for deletion");

            select("Slider");

            expect(screen.getByRole("button", { name: "B Marked · Undo" })).toHaveTextContent("Marked · Undo");
            expect(screen.getByRole("button", { name: "Mark A for deletion" })).toBeInTheDocument();
            expect(screen.getByTestId("delete-tag-b")).toHaveTextContent("B · Delete");
            expect(screen.queryByTestId("delete-tag-a")).not.toBeInTheDocument();
        });

        it("undoes a mark, and marks both files", () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());

            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            fireEvent.click(screen.getByRole("button", { name: "B Marked · Undo" }));

            expect(screen.getByRole("button", { name: "Mark B for deletion" })).toBeInTheDocument();
            expect(screen.queryByTestId("mark-wash")).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            // The wash covers a picture once it has loaded.
            for (const picture of document.querySelectorAll("img")) fireEvent.load(picture);

            expect(screen.getAllByTestId("mark-wash")).toHaveLength(2);
            expect(within(footer()).getByRole("status")).toHaveTextContent("2 files marked for deletion");
        });

        it("marks while comparing without touching the comparison, whose result still shows", async () => {
            const comparison = deferred<number>();
            mockedCompare.mockReturnValue(comparison.promise);
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());

            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));

            expect(screen.getByRole("button", { name: "A Marked · Undo" })).toBeInTheDocument();
            expect(scoreStatus()).toHaveTextContent("Comparing…");
            expect(mockedCompare).toHaveBeenCalledOnce();

            comparison.resolve(0.94522);
            await settle();

            expect(screen.getByRole("region", { name: "Similarity result" })).toHaveTextContent("95%");
            expect(screen.getByRole("button", { name: "A Marked · Undo" })).toBeInTheDocument();
        });

        it("marks after the comparison failed", async () => {
            mockedCompare.mockRejectedValue({ kind: "load", path: B.path, message: "failed to load image" });
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            await settle();

            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));

            expect(screen.getByRole("alert")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "B Marked · Undo" })).toBeInTheDocument();
        });

        it("starts the next pair unmarked, with focus on New comparison", () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));

            fireEvent.click(back());
            fireEvent.click(compare());

            expect(screen.getByRole("button", { name: "Mark A for deletion" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Mark B for deletion" })).toBeInTheDocument();
            expect(screen.queryByTestId("mark-wash")).not.toBeInTheDocument();
            expect(within(footer()).getByRole("status")).toHaveTextContent("Nothing marked yet.");
            expect(back()).toHaveFocus();
        });
    });

    describe("moving to the Trash", () => {
        const dismiss = () => screen.getByRole("button", { name: "Dismiss" });
        const notice = () => dismiss().closest('[role="status"]') as HTMLElement;

        /** Opens the pair, marks `slots`, and confirms the move. */
        const markAndMove = async (...slots: ("a" | "b")[]) => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            for (const slot of slots) {
                fireEvent.click(screen.getByRole("button", { name: `Mark ${slot.toUpperCase()} for deletion` }));
            }
            fireEvent.click(within(footer()).getByRole("button", { name: /Move \d to Trash…/ }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            await settle();
        };

        beforeEach(() => {
            mockedTrash.mockReset();
        });

        it("shows B gone with the notice, focus on Dismiss, and B in Trash in the slider", async () => {
            mockedTrash.mockResolvedValue([{ status: "trashed" }]);

            await markAndMove("b");

            expect(mockedTrash).toHaveBeenCalledExactlyOnceWith([B.identity]);
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
            expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent("Moved to Trash · 1.0 kB freed");
            expect(screen.getByRole("button", { name: "Mark A for deletion" })).toBeInTheDocument();
            expect(notice()).toHaveTextContent("1 file moved to Trash · 1.0 kB freed");
            await waitFor(() => expect(dismiss()).toHaveFocus());
            expect(within(footer()).getByRole("status")).toHaveTextContent("Nothing marked for deletion.");

            select("Slider");

            const slider = screen.getByRole("article", { name: "Files A and B" });
            expect(within(slider).getByText("In Trash")).toBeInTheDocument();
            expect(screen.queryByRole("slider")).not.toBeInTheDocument();
        });

        it("keeps the notice out of the footer", async () => {
            mockedTrash.mockResolvedValue([{ status: "trashed" }]);

            await markAndMove("b");

            expect(footer()).not.toContainElement(notice());
            expect(screen.getByRole("main")).not.toContainElement(notice());
        });

        it("withdraws Try again once a file is gone", async () => {
            mockedCompare.mockRejectedValue({ kind: "load", path: B.path, message: "boom" });
            mockedTrash.mockResolvedValue([{ status: "trashed" }]);

            await markAndMove("b");

            expect(screen.getByRole("alert")).toHaveTextContent("Couldn't compare these files");
            expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
        });

        it("returns to the start screen with B's slot empty and no notice", async () => {
            mockedTrash.mockResolvedValue([{ status: "trashed" }]);
            await markAndMove("b");

            fireEvent.click(back());

            const card = screen.getByRole("region", { name: "Compare two files" });
            expect(card).toHaveTextContent(A.name);
            expect(card).not.toHaveTextContent(B.name);
            expect(compare()).toBeDisabled();
            expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
        });

        it("keeps both slots after a failed move", async () => {
            mockedTrash.mockResolvedValue([{ status: "failed", reason: "trash", message: "no Trash on this volume" }]);
            await markAndMove("b");

            expect(notice()).toHaveTextContent(`Couldn't move ${B.name}: no Trash on this volume`);
            expect(screen.getByRole("button", { name: "B Marked · Undo" })).toBeInTheDocument();

            fireEvent.click(back());

            const card = screen.getByRole("region", { name: "Compare two files" });
            expect(card).toHaveTextContent(A.name);
            expect(card).toHaveTextContent(B.name);
        });

        it("starts a new pair with nothing gone", async () => {
            mockedTrash.mockResolvedValue([{ status: "trashed" }]);
            await markAndMove("b");
            fireEvent.click(back());
            act(() => usePairStore.setState({ b: B }));

            fireEvent.click(compare());

            expect(screen.getByRole("button", { name: "Mark A for deletion" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Mark B for deletion" })).toBeInTheDocument();
            expect(screen.queryByText(/Moved to Trash/)).not.toBeInTheDocument();
        });
    });

    describe("undoing a move", () => {
        const dismiss = () => screen.getByRole("button", { name: "Dismiss" });
        const notice = () => dismiss().closest('[role="status"]') as HTMLElement;
        const paneUndo = () => screen.getByRole("button", { name: `Undo moving ${B.name} to Trash` });

        /** Opens the pair, marks B, and moves it to the Trash. */
        const moveB = async () => {
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            fireEvent.click(within(footer()).getByRole("button", { name: "Move 1 to Trash…" }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            await settle();
        };

        beforeEach(() => {
            mockedTrash.mockReset().mockResolvedValue([{ status: "trashed" }]);
            mockedRestore.mockReset().mockResolvedValue([{ status: "restored", identity: B.identity }]);
        });

        it("brings B back in place from its pane, reports it, and moves focus to Dismiss", async () => {
            await moveB();

            fireEvent.click(paneUndo());
            await settle();

            expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([B.identity]);
            const pane = screen.getByRole("article", { name: "File B" });
            expect(pane).not.toHaveTextContent("Moved to Trash");
            expect(pane.querySelector("img")).toBeInTheDocument();
            expect(pane.querySelector("dl")).toBeInTheDocument();
            expect(within(pane).getByRole("button", { name: "Mark B for deletion" })).toBeInTheDocument();
            expect(notice()).toHaveTextContent(/^1 file restored$/);
            await waitFor(() => expect(dismiss()).toHaveFocus());
        });

        it("keeps B in place in the slider, with the handle", async () => {
            await moveB();
            fireEvent.click(paneUndo());
            await settle();

            select("Slider");

            const slider = screen.getByRole("article", { name: "Files A and B" });
            expect(within(slider).queryByText("In Trash")).not.toBeInTheDocument();
            expect(handle()).toBeInTheDocument();
        });

        it("restores from the notice in the slider", async () => {
            await moveB();
            select("Slider");

            fireEvent.click(screen.getByRole("button", { name: "Undo moving 1 file to Trash" }));
            await settle();

            const slider = screen.getByRole("article", { name: "Files A and B" });
            expect(within(slider).getByRole("button", { name: "Mark B for deletion" })).toBeInTheDocument();
            expect(handle()).toBeInTheDocument();
            expect(notice()).toHaveTextContent("1 file restored");
        });

        it("disables every Undo and starts no move while restoring", async () => {
            await moveB();
            mockedRestore.mockReturnValue(new Promise(() => {}));
            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));

            fireEvent.click(paneUndo());

            expect(paneUndo()).toBeDisabled();
            expect(screen.getByRole("button", { name: "Undo moving 1 file to Trash" })).toBeDisabled();
            fireEvent.click(within(footer()).getByRole("button", { name: "Move 1 to Trash…" }));
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        });

        it("puts the footer back to its first text", async () => {
            await moveB();
            expect(within(footer()).getByRole("status")).toHaveTextContent("Nothing marked for deletion.");

            fireEvent.click(paneUndo());
            await settle();

            expect(within(footer()).getByRole("status")).toHaveTextContent(
                "Nothing marked yet. Mark the file you don't need.",
            );
        });

        it("offers Try again again after a failed comparison", async () => {
            mockedCompare.mockRejectedValue({ kind: "load", path: B.path, message: "boom" });
            await moveB();
            expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();

            fireEvent.click(paneUndo());
            await settle();

            expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
        });

        it("keeps the score, starting no new comparison", async () => {
            mockedCompare.mockResolvedValue(0.94);
            await moveB();
            const result = () => screen.getByRole("region", { name: "Similarity result" });
            expect(result()).toHaveTextContent("94%");

            fireEvent.click(paneUndo());
            await settle();

            expect(result()).toHaveTextContent("94%");
            expect(mockedCompare).toHaveBeenCalledOnce();
        });

        it("returns to the start screen with both slots filled", async () => {
            await moveB();
            fireEvent.click(paneUndo());
            await settle();

            fireEvent.click(back());

            const card = screen.getByRole("region", { name: "Compare two files" });
            expect(card).toHaveTextContent(A.name);
            expect(card).toHaveTextContent(B.name);
            expect(compare()).toBeEnabled();
        });

        it("keeps B gone with its Undo when the restore fails", async () => {
            mockedRestore.mockResolvedValue([
                { status: "failed", reason: "gone", message: "it is no longer in the Trash" },
            ]);
            await moveB();

            fireEvent.click(paneUndo());
            await settle();

            expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent("Moved to Trash");
            expect(paneUndo()).toBeEnabled();
            expect(notice()).toHaveTextContent(`Couldn't restore ${B.name}: it is no longer in the Trash`);
        });

        it("replaces the move's notice when one of two moved files is restored from its pane", async () => {
            mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "trashed" }]);
            mockedRestore.mockResolvedValue([{ status: "restored", identity: A.identity }]);
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            fireEvent.click(screen.getByRole("button", { name: "Mark A for deletion" }));
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            fireEvent.click(within(footer()).getByRole("button", { name: "Move 2 to Trash…" }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            await settle();

            fireEvent.click(screen.getByRole("button", { name: `Undo moving ${A.name} to Trash` }));
            await settle();

            expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([A.identity]);
            expect(notice()).toHaveTextContent(/^1 file restored$/);
            expect(within(notice()).queryByRole("button", { name: /^Undo moving/ })).not.toBeInTheDocument();
            expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent("Moved to Trash");
            expect(paneUndo()).toBeEnabled();
        });

        it("offers no Undo for a new pair", async () => {
            const other = media("other.jpg");
            await moveB();
            fireEvent.click(back());
            act(() => usePairStore.setState({ b: other }));

            fireEvent.click(compare());

            expect(screen.queryByRole("button", { name: /^Undo moving/ })).not.toBeInTheDocument();
        });
    });
});
