import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type DragDropEvent, onDragDrop } from "@/ipc/dragDrop";
import type { MediaType } from "@/ipc/formats";
import { addToSet, rescanSet } from "@/ipc/set";
import { describeMedia, type MediaFile } from "@/ipc/thumbs";
import { useHomeStore } from "@/stores/home";
import { usePairStore } from "@/stores/pair";
import { PairCard } from "./PairCard";
import { SetCard } from "./SetCard";

vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn() }));
vi.mock("@/ipc/dialog", () => ({ pickFile: vi.fn(), pickFiles: vi.fn(), pickFolders: vi.fn() }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/thumbs", () => ({
    describeMedia: vi.fn(),
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const mockedDescribe = describeMedia as Mock;
const mockedAddToSet = addToSet as Mock;

const HINT = "Both files must be images, or both videos.";

const media = (name: string, type: MediaType = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

/** Describe each dropped path as an image named after it, and anything ending in `.txt` or `/` as unplaceable. */
const describeAsImages = () =>
    mockedDescribe.mockImplementation((paths: string[]) =>
        Promise.resolve(
            paths.map((path) =>
                path.endsWith(".txt") || path.endsWith("/") ? undefined : media(path.split("/").at(-1) ?? path),
            ),
        ),
    );

/** Send a drag event to every listener registered. */
const drag = (event: DragDropEvent) =>
    act(() => {
        for (const [handler] of (onDragDrop as Mock).mock.calls) handler(event);
    });

/** Lay `element` out at the given CSS-pixel box; jsdom lays nothing out itself. */
const placeAt = (element: HTMLElement, x: number, y: number, width: number, height: number) => {
    element.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width, height });
};

const card = () => screen.getByRole("region", { name: "Compare two files" });
const slotBox = (name: string) =>
    (screen.queryByRole("button", { name }) ?? screen.getByRole("group", { name })).parentElement as HTMLElement;
const compare = () => screen.getByRole("button", { name: "Compare" });

/**
 * Lay the card out as the window draws it, in CSS pixels: the card at (0, 0, 500, 400), File A at
 * (28, 100) and File B at (260, 100), each 220×210, and the heading above them.
 */
const layOut = () => {
    placeAt(card(), 0, 0, 500, 400);
    placeAt(slotBox("File A"), 28, 100, 220, 210);
    placeAt(slotBox("File B"), 260, 100, 220, 210);
};

const ON_A = { x: 100, y: 200 };
const ON_B = { x: 350, y: 200 };
const ON_HEADING = { x: 100, y: 40 };

describe("PairCard", () => {
    beforeEach(() => {
        usePairStore.setState(usePairStore.getInitialState(), true);
        useHomeStore.setState(useHomeStore.getInitialState(), true);
        describeAsImages();
    });

    it("shows its title and description", () => {
        render(<PairCard />);

        expect(card()).toHaveTextContent("Get one similarity score for two images or two videos.");
    });

    it("shows two operable empty slots, the hint and a disabled Compare when empty", () => {
        render(<PairCard />);

        for (const name of ["File A", "File B"]) {
            const slot = screen.getByRole("button", { name });

            expect(slot).toHaveAccessibleDescription("Drop or click to choose");
            expect(slot).toBeEnabled();
        }
        expect(screen.getByText(HINT)).toHaveClass("text-muted-foreground");
        expect(compare()).toBeDisabled();
    });

    it("keeps Compare disabled with only one file", () => {
        usePairStore.setState({ a: media("a.jpg") });
        render(<PairCard />);

        expect(screen.getByRole("group", { name: "File A" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "File B" })).toBeEnabled();
        expect(compare()).toBeDisabled();
    });

    it("enables Compare for two images", () => {
        usePairStore.setState({ a: media("a.jpg"), b: media("b.png") });
        render(<PairCard />);

        expect(compare()).toBeEnabled();
        expect(screen.getByText(HINT)).not.toHaveClass("text-warning");
    });

    it("enables Compare for two videos", () => {
        usePairStore.setState({ a: media("a.mov", "video"), b: media("b.mp4", "video") });
        render(<PairCard />);

        expect(compare()).toBeEnabled();
    });

    it("warns and disables Compare for an image and a video, and announces it", () => {
        usePairStore.setState({ a: media("a.jpg"), b: media("b.mov", "video") });
        const { container } = render(<PairCard />);

        const hint = screen.getByText(HINT);
        expect(hint).toHaveClass("text-warning");
        expect(hint.parentElement).toHaveAttribute("aria-live", "polite");
        expect(hint.parentElement).toHaveTextContent(`Warning: ${HINT}`);
        expect(container.querySelector(".lucide-triangle-alert")).toBeInTheDocument();
        expect(compare()).toBeDisabled();
    });

    it("clears the warning when the mismatch is resolved", () => {
        usePairStore.setState({ a: media("a.jpg"), b: media("b.mov", "video") });
        const { container } = render(<PairCard />);

        act(() => usePairStore.setState({ b: media("b.png") }));

        expect(screen.getByText(HINT)).toHaveClass("text-muted-foreground");
        expect(screen.getByText(HINT).parentElement).not.toHaveTextContent("Warning:");
        expect(container.querySelector(".lucide-triangle-alert")).not.toBeInTheDocument();
        expect(compare()).toBeEnabled();
    });

    it("empties a slot on remove, keeps the other, and focuses the emptied slot", () => {
        usePairStore.setState({ a: media("a.jpg"), b: media("b.png") });
        render(<PairCard />);

        fireEvent.click(screen.getByRole("button", { name: "Remove file A" }));

        expect(screen.getByRole("button", { name: "File A" })).toHaveFocus();
        expect(screen.getByRole("group", { name: "File B" })).toBeInTheDocument();
        expect(compare()).toBeDisabled();
    });

    it("places one file dropped onto a slot in that slot, replacing its file", async () => {
        usePairStore.setState({ a: media("a.jpg") });
        render(<PairCard />);
        layOut();

        drag({ type: "drop", paths: ["/media/c.jpg"], position: ON_A } as DragDropEvent);

        await waitFor(() => expect(usePairStore.getState().a).toEqual(media("c.jpg")));
        expect(usePairStore.getState().b).toBeUndefined();
    });

    it("places one file dropped onto the card in the first empty slot", async () => {
        usePairStore.setState({ a: media("a.jpg") });
        render(<PairCard />);
        layOut();

        drag({ type: "drop", paths: ["/media/b.jpg"], position: ON_HEADING } as DragDropEvent);

        await waitFor(() => expect(screen.getByRole("group", { name: "File B" })).toHaveTextContent("b.jpg"));
        expect(usePairStore.getState().a).toEqual(media("a.jpg"));
    });

    it("fills both slots from two files dropped onto one slot", async () => {
        render(<PairCard />);
        layOut();

        drag({ type: "drop", paths: ["/media/x.jpg", "/media/y.jpg"], position: ON_B } as DragDropEvent);

        await waitFor(() => expect(screen.getByRole("group", { name: "File A" })).toHaveTextContent("x.jpg"));
        expect(screen.getByRole("group", { name: "File B" })).toHaveTextContent("y.jpg");
        expect(compare()).toBeEnabled();
    });

    it("skips folders and unsupported files in a drop", async () => {
        render(<PairCard />);
        layOut();

        drag({
            type: "drop",
            paths: ["/media/folder/", "/media/notes.txt", "/media/photo.jpg"],
            position: ON_B,
        } as DragDropEvent);

        await waitFor(() => expect(usePairStore.getState().b).toEqual(media("photo.jpg")));
        expect(usePairStore.getState().a).toBeUndefined();
    });

    it("highlights the slot a drag over the card would fill, until the drag leaves", () => {
        render(<PairCard />);
        layOut();

        drag({ type: "enter", paths: ["/media/a.jpg"], position: ON_A } as DragDropEvent);
        expect(screen.getByRole("button", { name: "File A" })).toHaveClass("bg-card");
        expect(screen.getByRole("button", { name: "File B" })).not.toHaveClass("bg-card");

        drag({ type: "over", position: ON_HEADING } as DragDropEvent);
        expect(screen.getByRole("button", { name: "File A" })).toHaveClass("bg-card");

        drag({ type: "leave" } as DragDropEvent);
        expect(screen.getByRole("button", { name: "File A" })).not.toHaveClass("bg-card");
    });

    it("highlights both slots while two files are dragged over the card", () => {
        usePairStore.setState({ a: media("a.jpg") });
        render(<PairCard />);
        layOut();

        drag({ type: "enter", paths: ["/media/x.jpg", "/media/y.jpg"], position: ON_B } as DragDropEvent);

        expect(screen.getByRole("group", { name: "File A" })).toHaveClass("border-border-hover");
        expect(screen.getByRole("button", { name: "File B" })).toHaveClass("bg-card");

        drag({ type: "drop", paths: ["/media/x.jpg", "/media/y.jpg"], position: ON_B } as DragDropEvent);
        expect(screen.getByRole("group", { name: "File A" })).not.toHaveClass("border-border-hover");
    });

    describe("next to the set card", () => {
        beforeEach(() => {
            (rescanSet as Mock).mockResolvedValue({ revision: 0, sources: [], total: 0 });
            mockedAddToSet.mockResolvedValue({ revision: 0, sources: [], total: 0 });
        });

        const layOutBoth = () => {
            layOut();
            placeAt(screen.getByRole("region", { name: "Find similar in a set" }), 520, 0, 500, 400);
            placeAt(screen.getByRole("button", { name: /Drop files or folders here/ }), 548, 100, 444, 210);
        };

        it("leaves the pair unchanged when files are dropped onto the set card", async () => {
            render(
                <>
                    <PairCard />
                    <SetCard />
                </>,
            );
            layOutBoth();

            drag({ type: "drop", paths: ["/media/photo.jpg"], position: { x: 700, y: 200 } } as DragDropEvent);

            await waitFor(() => expect(mockedAddToSet).toHaveBeenCalledOnce());
            expect(mockedDescribe).not.toHaveBeenCalled();
            expect(usePairStore.getState().a).toBeUndefined();
            expect(usePairStore.getState().b).toBeUndefined();
        });

        it("leaves the set unchanged when files are dropped onto the pair card", async () => {
            render(
                <>
                    <PairCard />
                    <SetCard />
                </>,
            );
            layOutBoth();

            drag({ type: "drop", paths: ["/media/photo.jpg"], position: ON_A } as DragDropEvent);

            await waitFor(() => expect(usePairStore.getState().a).toEqual(media("photo.jpg")));
            expect(mockedAddToSet).not.toHaveBeenCalled();
            expect(useHomeStore.getState().sources).toEqual([]);
        });
    });
});
