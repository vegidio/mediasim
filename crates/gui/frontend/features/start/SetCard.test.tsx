import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ComparisonSection } from "@/features/settings/ComparisonSection";
import { type DragDropEvent, onDragDrop } from "@/ipc/dragDrop";
import { addToSet, rescanSet, type SourceView } from "@/ipc/set";
import { useGalleryStore } from "@/stores/gallery";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { type SourceRow, useStartStore } from "@/stores/start";
import { SetCard } from "./SetCard";

vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));
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
        localStorage.clear();
        // Settings first: resetting them afterwards would reach the start store through its subscription.
        useSettingsStore.setState(SETTINGS_DEFAULTS);
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

    it("opens the gallery from an enabled Continue", () => {
        useScreenStore.setState(useScreenStore.getInitialState(), true);
        withSources([folder()], 49);
        render(<SetCard />);

        fireEvent.click(screen.getByRole("button", { name: "Continue with 49 files" }));

        expect(useScreenStore.getState().screen).toBe("gallery");
    });

    it("starts the gallery's threshold from the setting on Continue", () => {
        useSettingsStore.getState().update({ matchThreshold: 90 });
        useGalleryStore.getState().setThreshold(72);
        withSources([folder()], 49);
        render(<SetCard />);

        fireEvent.click(screen.getByRole("button", { name: "Continue with 49 files" }));

        expect(useGalleryStore.getState().threshold).toBe(90);
    });

    it("recounts the set on Continue, so the gallery sees the folders as they are on disk", () => {
        withSources([folder()], 49);
        render(<SetCard />);

        fireEvent.click(screen.getByRole("button", { name: "Continue with 49 files" }));

        expect(rescanSet).toHaveBeenCalledExactlyOnceWith(useStartStore.getState().scanSubfolders);
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

        expect(mockedAddToSet).toHaveBeenCalledExactlyOnceWith(["/Pictures", "/photo.jpg"], false);
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

        expect(mockedAddToSet).toHaveBeenCalledExactlyOnceWith(["/more.png"], false);
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

    it("starts with Scan subfolders unchecked", () => {
        render(<SetCard />);

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).not.toBeChecked();
    });

    it("toggles Scan subfolders from the box", () => {
        render(<SetCard />);
        const checkbox = screen.getByRole("checkbox", { name: "Scan subfolders" });

        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();
        expect(useStartStore.getState().scanSubfolders).toBe(true);
        expect(rescanSet).toHaveBeenCalledExactlyOnceWith(true);

        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
    });

    it("toggles Scan subfolders from its label", () => {
        render(<SetCard />);

        fireEvent.click(screen.getByText("Scan subfolders"));

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).toBeChecked();
        expect(useStartStore.getState().scanSubfolders).toBe(true);
    });

    it("starts with Scan subfolders checked when the setting is stored as on", async () => {
        localStorage.setItem(
            "settings-storage",
            JSON.stringify({ state: { ...SETTINGS_DEFAULTS, scanSubfolders: true }, version: 1 }),
        );
        vi.resetModules();

        // A fresh launch: the stores are created anew, and read the stored setting.
        const { SetCard: LaunchedSetCard } = await import("./SetCard");
        render(<LaunchedSetCard />);

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).toBeChecked();
    });

    it("follows the Scan subfolders setting while shown", () => {
        render(
            <>
                <SetCard />
                <ComparisonSection />
            </>,
        );

        fireEvent.click(screen.getByRole("switch", { name: "Scan subfolders" }));

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).toBeChecked();
        expect(rescanSet).toHaveBeenCalledExactlyOnceWith(true);

        fireEvent.click(screen.getByRole("switch", { name: "Scan subfolders" }));

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).not.toBeChecked();
    });
});
