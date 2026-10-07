import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { cancelComparison, comparePair, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { deleteMedia, restoreMedia, trashMedia } from "@/ipc/trash";
import { usePairStore } from "@/stores/pair";
import { usePairResultStore } from "@/stores/pairResult";
import { usePairViewStore } from "@/stores/pairView";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/thumbs", () => ({
    describeMedia: vi.fn(),
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    // H.264 and AAC in MP4, which the test setup's `canPlayType` plays directly.
    probeVideo: async () => ({
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: 42,
        video: { codec: "h264", codecString: "avc1.640028" },
        audio: { codec: "aac", codecString: "mp4a.40.2" },
    }),
    // A remux, which an error before the first frame falls back to, fails too: these files can't be played at all.
    remuxOpen: vi.fn(async () => {
        throw { kind: "unreadable", message: "not a video" };
    }),
    remuxNext: vi.fn(),
    remuxClose: vi.fn(async () => {}),
}));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), restoreMedia: vi.fn(), deleteMedia: vi.fn() }));

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
        useSettingsStore.setState(SETTINGS_DEFAULTS);
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

    describe("deleting permanently", () => {
        /** Opens the pair, marks B, and confirms its permanent deletion. */
        const markAndDelete = async () => {
            useSettingsStore.setState({ deletionMode: "permanent" });
            (deleteMedia as Mock).mockReset().mockResolvedValue([{ status: "deleted" }]);
            usePairStore.setState({ a: A, b: B });
            render(<App />);
            fireEvent.click(compare());
            fireEvent.click(screen.getByRole("button", { name: "Mark B for deletion" }));
            fireEvent.click(within(footer()).getByRole("button", { name: "Delete 1 permanently…" }));
            fireEvent.click(
                within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }),
            );
            await settle();
        };

        it("shows B deleted with no Undo anywhere, and Deleted in the slider", async () => {
            await markAndDelete();

            expect(deleteMedia as Mock).toHaveBeenCalledExactlyOnceWith([B.identity]);
            expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent(
                "Deleted permanently · 1.0 kB freed",
            );
            expect(screen.getByRole("button", { name: "Dismiss" }).closest('[role="status"]')).toHaveTextContent(
                /^1 file deleted · 1\.0 kB freed$/,
            );
            expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
            expect(within(footer()).getByRole("status")).toHaveTextContent("Nothing marked for deletion.");

            select("Slider");

            expect(
                within(screen.getByRole("article", { name: "Files A and B" })).getByText("Deleted"),
            ).toBeInTheDocument();
        });

        it("withdraws Try again once a file is deleted", async () => {
            mockedCompare.mockRejectedValue({ kind: "load", path: B.path, message: "boom" });

            await markAndDelete();

            expect(screen.getByRole("alert")).toHaveTextContent("Couldn't compare these files");
            expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
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

    describe("playing videos", () => {
        const VA = media("VID_0714.mov", "video");
        const VB = media("VID_0714-copy.mp4", "video");

        /** The `<video>` in a pane, which has no accessible role. */
        const videoOf = (pane: string) =>
            screen.getByRole("article", { name: pane }).querySelector("video") as HTMLVideoElement;
        const button = (name: string) => screen.getByRole("button", { name });
        /** Lets the players just mounted probe their videos and decide how to play them. */
        const settle = () => act(async () => {});
        /** The slider's two `<video>` elements, A's then B's. */
        const sliderVideos = () =>
            [VA, VB].map(
                (file) =>
                    screen
                        .getByTestId("slider-stage")
                        .querySelector(`video[src="video://localhost/${file.identity}"]`) as HTMLVideoElement,
            );

        /** Opens a pair of videos in the slider, each knowing its duration, and plays both with A's sound on. */
        const openAndPlaySlider = async () => {
            usePairStore.setState({ a: VA, b: VB });
            render(<App />);
            fireEvent.click(compare());
            await settle();
            select("Slider");
            await settle();
            act(() => {
                for (const video of sliderVideos()) Object.assign(video, { duration: 42 });
            });
            fireEvent.click(button("Play A and B"));
            fireEvent.click(button("Unmute A"));
            const videos = sliderVideos();
            expect(videos.map((video) => video.paused)).toEqual([false, false]);
            expect(videos[0]?.muted).toBe(false);
            return videos;
        };

        /** Opens a pair of videos side by side, each knowing its duration, and plays A. */
        const openAndPlayA = async () => {
            usePairStore.setState({ a: VA, b: VB });
            render(<App />);
            fireEvent.click(compare());
            await settle();
            act(() => {
                // Read-only to the type, as the element sets it; the test setup's stub lets a test stand for that.
                Object.assign(videoOf("File A"), { duration: 42 });
                Object.assign(videoOf("File B"), { duration: 42 });
            });
            fireEvent.click(button("Play VID_0714.mov"));
        };

        it("plays and unmutes A alone, leaving B paused and muted", async () => {
            await openAndPlayA();
            fireEvent.click(button("Unmute VID_0714.mov"));

            expect(videoOf("File A").paused).toBe(false);
            expect(videoOf("File A").muted).toBe(false);
            expect(videoOf("File B").paused).toBe(true);
            expect(videoOf("File B").muted).toBe(true);
            expect(button("Play VID_0714-copy.mp4")).toBeInTheDocument();
            expect(button("Unmute VID_0714-copy.mp4")).toBeInTheDocument();
        });

        it("stops A when the slider is selected, which shows stills with its shared player bar at 0:00", async () => {
            await openAndPlayA();
            fireEvent.click(button("Unmute VID_0714.mov"));
            const playing = videoOf("File A");

            select("Slider");

            await settle();

            expect(playing.paused).toBe(true);
            expect(playing).not.toHaveAttribute("src");
            expect(screen.getByRole("group", { name: "Player for A and B" })).toHaveTextContent(/^0:00 \//);
            expect(button("Play A and B")).toBeInTheDocument();
            for (const video of sliderVideos()) {
                expect(video.paused).toBe(true);
                expect(video).toHaveClass("invisible");
            }
            expect(screen.getByTestId("slider-stage").querySelectorAll("img")).toHaveLength(2);
        });

        it("starts A again paused at its beginning and muted back side by side", async () => {
            await openAndPlayA();
            fireEvent.click(button("Unmute VID_0714.mov"));
            act(() => {
                videoOf("File A").currentTime = 30;
            });

            select("Slider");

            await settle();
            select("Side by side");
            await settle();

            expect(button("Play VID_0714.mov")).toBeInTheDocument();
            expect(button("Unmute VID_0714.mov")).toBeInTheDocument();
            expect(screen.getByRole("group", { name: "Player for VID_0714.mov" })).toHaveTextContent(/^0:00 \//);
            expect(videoOf("File A").paused).toBe(true);
            expect(videoOf("File A").muted).toBe(true);
            expect(videoOf("File A")).toHaveClass("invisible");
        });

        it("stops B when it is moved to the Trash while playing, showing its placeholder", async () => {
            mockedTrash.mockReset().mockResolvedValue([{ status: "trashed" }]);
            usePairStore.setState({ a: VA, b: VB });
            render(<App />);
            fireEvent.click(compare());
            await settle();
            fireEvent.click(button("Play VID_0714-copy.mp4"));
            const playing = videoOf("File B");
            expect(playing.paused).toBe(false);

            fireEvent.click(button("Mark B for deletion"));
            fireEvent.click(within(footer()).getByRole("button", { name: /Move \d to Trash…/ }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            await settle();

            expect(playing.paused).toBe(true);
            expect(playing).not.toHaveAttribute("src");
            expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent("Moved to Trash");
            expect(videoOf("File A").paused).toBe(true);
        });

        it("stops B when it is deleted permanently while playing, showing its placeholder", async () => {
            useSettingsStore.setState({ deletionMode: "permanent" });
            (deleteMedia as Mock).mockReset().mockResolvedValue([{ status: "deleted" }]);
            usePairStore.setState({ a: VA, b: VB });
            render(<App />);
            fireEvent.click(compare());
            await settle();
            fireEvent.click(button("Play VID_0714-copy.mp4"));
            const playing = videoOf("File B");
            expect(playing.paused).toBe(false);

            fireEvent.click(button("Mark B for deletion"));
            fireEvent.click(within(footer()).getByRole("button", { name: "Delete 1 permanently…" }));
            fireEvent.click(
                within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }),
            );
            await settle();

            expect(playing.paused).toBe(true);
            expect(playing).not.toHaveAttribute("src");
            expect(screen.getByRole("article", { name: "File B" })).toHaveTextContent("Deleted permanently");
            expect(videoOf("File A").paused).toBe(true);
        });

        it("stops both on New comparison", async () => {
            await openAndPlayA();
            fireEvent.click(button("Play VID_0714-copy.mp4"));
            const [a, b] = [videoOf("File A"), videoOf("File B")];

            fireEvent.click(back());

            expect(a.paused).toBe(true);
            expect(b.paused).toBe(true);
            expect(document.querySelector("video")).not.toBeInTheDocument();
        });
        it("stops both slider videos on Side by side, whose panes start paused at 0:00 and muted", async () => {
            const playing = await openAndPlaySlider();

            select("Side by side");

            await settle();

            for (const video of playing) {
                expect(video.paused).toBe(true);
                expect(video).not.toHaveAttribute("src");
            }
            for (const [pane, name] of [
                ["File A", "VID_0714.mov"],
                ["File B", "VID_0714-copy.mp4"],
            ] as const) {
                expect(screen.getByRole("group", { name: `Player for ${name}` })).toHaveTextContent(/^0:00 \//);
                expect(videoOf(pane).paused).toBe(true);
                expect(videoOf(pane).muted).toBe(true);
            }
        });

        it("stops both slider videos on New comparison", async () => {
            const playing = await openAndPlaySlider();

            fireEvent.click(back());

            for (const video of playing) {
                expect(video.paused).toBe(true);
                expect(video).not.toHaveAttribute("src");
            }
            expect(document.querySelector("video")).not.toBeInTheDocument();
            expect(compare()).toBeInTheDocument();
        });

        it("stops both slider videos when B is moved to the Trash, leaving A its own player at 0:00, muted", async () => {
            mockedTrash.mockReset().mockResolvedValue([{ status: "trashed" }]);
            const playing = await openAndPlaySlider();

            fireEvent.click(button("Mark B for deletion"));
            fireEvent.click(within(footer()).getByRole("button", { name: /Move \d to Trash…/ }));
            fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
            await settle();

            for (const video of playing) {
                expect(video.paused).toBe(true);
                expect(video).not.toHaveAttribute("src");
            }
            expect(screen.queryByRole("group", { name: "Player for A and B" })).not.toBeInTheDocument();
            expect(screen.getByRole("group", { name: "Player for VID_0714.mov" })).toHaveTextContent(/^0:00 \//);
            const lone = screen.getByTestId("slider-stage").querySelectorAll("video");
            expect(lone).toHaveLength(1);
            expect(lone[0]).toMatchObject({ paused: true, muted: true });
            expect(button("Unmute VID_0714.mov")).toBeInTheDocument();
        });
    });
});
