import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type DragDropEvent, onDragDrop } from "@/ipc/dragDrop";
import { addToSet, rescanSet, type SourceView } from "@/ipc/set";
import { type SourceRow, useStartStore } from "@/stores/start";
import { SetCard } from "./SetCard";

vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn() }));
vi.mock("@/ipc/dialog", () => ({ pickFiles: vi.fn(), pickFolders: vi.fn() }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));

const mockedAddToSet = addToSet as Mock;

const folder = (overrides: Partial<SourceView> = {}): SourceView => ({
    path: "/Pictures",
    name: "Pictures",
    location: "~/Pictures",
    kind: "folder",
    count: 49,
    size: 0,
    unreadable: false,
    pending: false,
    ...overrides,
});

const withSources = (sources: SourceRow[], total: number) =>
    useStartStore.setState((state) => ({ sources, view: { ...state.view, total } }));

/** Send a drag event to every listener the card registered. */
const drag = (event: DragDropEvent) =>
    act(() => {
        for (const [handler] of (onDragDrop as Mock).mock.calls) handler(event);
    });

/** Lay `element` out at the given CSS-pixel box; jsdom lays nothing out itself. */
const placeAt = (element: HTMLElement, x: number, y: number, width: number, height: number) => {
    element.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width, height });
};

const dropArea = () => screen.getByRole("button", { name: /Drop files or folders here/ });

describe("SetCard", () => {
    beforeEach(() => {
        useStartStore.setState(useStartStore.getInitialState(), true);
        (rescanSet as Mock).mockResolvedValue({ revision: 0, sources: [], total: 0 });
        mockedAddToSet.mockResolvedValue({ revision: 0, sources: [], total: 0 });
    });

    it("shows its title and description", () => {
        render(<SetCard />);

        expect(screen.getByRole("region", { name: "Find similar in a set" })).toHaveTextContent(
            "Group lookalikes across many files, then clean up the extras.",
        );
    });

    it("has an operable drop area that opens a menu", () => {
        render(<SetCard />);

        const dropArea = screen.getByRole("button", { name: /Drop files or folders here/ });
        expect(dropArea).toHaveTextContent("or click to browse");
        expect(dropArea).toBeEnabled();
        expect(dropArea).toHaveAttribute("aria-haspopup", "menu");
    });

    it("has Continue disabled while the set is empty", () => {
        render(<SetCard />);

        expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    });

    it("shows the set list in place of the drop area once something is added", () => {
        withSources([folder()], 49);
        render(<SetCard />);

        expect(screen.queryByRole("button", { name: /Drop files or folders here/ })).not.toBeInTheDocument();
        expect(screen.getByRole("list", { name: "Selected sources" })).toHaveTextContent("Pictures");
    });

    it("enables Continue with the file count once counting has finished", () => {
        withSources([folder()], 49);
        render(<SetCard />);

        expect(screen.getByRole("button", { name: "Continue with 49 files" })).toBeEnabled();
    });

    it("reads Continue with 1 file for a single file", () => {
        withSources([folder({ count: 1 })], 1);
        render(<SetCard />);

        expect(screen.getByRole("button", { name: "Continue with 1 file" })).toBeEnabled();
    });

    it("keeps Continue disabled with only empty folders", () => {
        withSources([folder({ count: 0 })], 0);
        render(<SetCard />);

        expect(screen.getByRole("button", { name: "Continue with 0 files" })).toBeDisabled();
    });

    it("keeps Continue disabled while a folder is still being counted", () => {
        withSources([folder({ count: 1 }), folder({ path: "/Big", name: "Big", count: 0, pending: true })], 1);
        render(<SetCard />);

        expect(screen.getByRole("button", { name: "Continue with 1 file" })).toBeDisabled();
    });

    it("brings the drop area back when the last source is removed", () => {
        withSources([folder()], 49);
        render(<SetCard />);

        act(() => withSources([], 0));

        expect(dropArea()).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    });

    it("adds what is dropped onto the drop area", () => {
        render(<SetCard />);
        placeAt(dropArea(), 100, 100, 400, 210);

        drag({ type: "drop", paths: ["/Pictures", "/photo.jpg"], position: { x: 300, y: 200 } } as DragDropEvent);

        expect(mockedAddToSet).toHaveBeenCalledExactlyOnceWith(["/Pictures", "/photo.jpg"], true);
    });

    it("ignores a drop outside the drop area", () => {
        render(<SetCard />);
        placeAt(dropArea(), 100, 100, 400, 210);

        // Below the drop area, on the other card or the footer.
        drag({ type: "drop", paths: ["/photo.jpg"], position: { x: 300, y: 400 } } as DragDropEvent);

        expect(mockedAddToSet).not.toHaveBeenCalled();
    });

    it("adds what is dropped onto the set list", () => {
        withSources([folder()], 49);
        render(<SetCard />);
        const box = screen.getByRole("list", { name: "Selected sources" }).parentElement as HTMLElement;
        placeAt(box, 0, 0, 400, 210);

        drag({ type: "drop", paths: ["/more.png"], position: { x: 50, y: 50 } } as DragDropEvent);

        expect(mockedAddToSet).toHaveBeenCalledExactlyOnceWith(["/more.png"], true);
    });

    it("highlights the drop area while a drag is over it", () => {
        render(<SetCard />);
        placeAt(dropArea(), 0, 0, 400, 210);

        drag({ type: "enter", paths: ["/a.jpg"], position: { x: 10, y: 10 } } as DragDropEvent);
        expect(dropArea()).toHaveClass("bg-card");

        drag({ type: "over", position: { x: 900, y: 10 } } as DragDropEvent);
        expect(dropArea()).not.toHaveClass("bg-card");

        drag({ type: "over", position: { x: 10, y: 10 } } as DragDropEvent);
        expect(dropArea()).toHaveClass("bg-card");

        drag({ type: "leave" });
        expect(dropArea()).not.toHaveClass("bg-card");
    });

    it("drops the highlight when the drag ends in a drop", () => {
        render(<SetCard />);
        placeAt(dropArea(), 0, 0, 400, 210);

        drag({ type: "enter", paths: ["/a.jpg"], position: { x: 10, y: 10 } } as DragDropEvent);
        drag({ type: "drop", paths: ["/a.jpg"], position: { x: 900, y: 10 } } as DragDropEvent);
        expect(dropArea()).not.toHaveClass("bg-card");

        // A drop inside swaps the drop area for the list, which must not inherit the highlight.
        drag({ type: "enter", paths: ["/a.jpg"], position: { x: 10, y: 10 } } as DragDropEvent);
        drag({ type: "drop", paths: ["/a.jpg"], position: { x: 10, y: 10 } } as DragDropEvent);
        const box = screen.getByRole("list", { name: "Selected sources" }).parentElement;
        expect(box).not.toHaveClass("bg-card");
    });

    it("starts with Scan subfolders checked", () => {
        render(<SetCard />);

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).toBeChecked();
    });

    it("toggles Scan subfolders from the box", () => {
        render(<SetCard />);
        const checkbox = screen.getByRole("checkbox", { name: "Scan subfolders" });

        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
        expect(useStartStore.getState().scanSubfolders).toBe(false);
        expect(rescanSet).toHaveBeenCalledExactlyOnceWith(false);

        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();
    });

    it("toggles Scan subfolders from its label", () => {
        render(<SetCard />);

        fireEvent.click(screen.getByText("Scan subfolders"));

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).not.toBeChecked();
        expect(useStartStore.getState().scanSubfolders).toBe(false);
    });
});
