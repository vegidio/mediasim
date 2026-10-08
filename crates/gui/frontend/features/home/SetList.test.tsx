import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { clearSet, removeFromSet, type SourceView } from "@/ipc/set";
import { type SourceRow, useHomeStore } from "@/stores/home";
import { SetList } from "./SetList";

vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), clearSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn() }));
vi.mock("@/ipc/dialog", () => ({ pickFiles: vi.fn(), pickFolders: vi.fn() }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));

const source = (overrides: Partial<SourceView>): SourceView => ({
    path: "/x",
    name: "x",
    location: "~",
    kind: "image",
    count: 1,
    size: 0,
    unreadable: false,
    pending: false,
    ...overrides,
});

const holiday = source({
    path: "/Users/me/Pictures/Holiday 2025",
    name: "Holiday 2025",
    location: "~/Pictures/Holiday 2025",
    kind: "folder",
    count: 48,
    size: 1_200_000_000,
});
const heic = source({
    path: "/Users/me/Downloads/IMG_9921.HEIC",
    name: "IMG_9921.HEIC",
    location: "~/Downloads",
    size: 3_100_000,
});

const show = (sources: SourceRow[], onCleared?: () => void) => {
    useHomeStore.setState({ sources });
    render(<SetList {...(onCleared && { onCleared })} />);
};

/** The row whose name is `name`. */
const row = (name: string) => {
    const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name));
    if (!item) throw new Error(`no row named ${name}`);
    return item;
};

describe("SetList", () => {
    beforeEach(() => {
        useHomeStore.setState(useHomeStore.getInitialState(), true);
    });

    it("shows a folder's path, count and size, and a file's folder and size, in order", () => {
        show([holiday, heic]);

        const rows = within(screen.getByRole("list", { name: "Selected sources" })).getAllByRole("listitem");
        expect(rows.map((li) => li.textContent)).toEqual([
            "Holiday 2025~/Pictures/Holiday 2025 · 48 files · 1.2 GB",
            "IMG_9921.HEIC~/Downloads · 3.1 MB",
        ]);
    });

    it("cuts a long location rather than the count and size", () => {
        show([holiday]);

        const location = screen.getByText("~/Pictures/Holiday 2025");
        expect(location).toHaveClass("truncate");
        expect(location.nextElementSibling).toHaveTextContent("· 48 files · 1.2 GB");
        expect(location.nextElementSibling).toHaveClass("shrink-0");
    });

    it("reads 1 file for a folder holding one", () => {
        show([source({ name: "One", location: "~/One", kind: "folder", count: 1, size: 2000 })]);

        expect(row("One")).toHaveTextContent("~/One · 1 file · 2.0 kB");
    });

    it("shows Counting… for a folder being counted and for a row Rust has not described yet", () => {
        show([
            source({ path: "/a", name: "Big", kind: "folder", count: 0, pending: true }),
            { path: "/b", name: "Just added", pending: true },
        ]);

        expect(row("Big")).toHaveTextContent("Counting…");
        expect(row("Just added")).toHaveTextContent("Counting…");
    });

    it("shows Can't read this folder for an unreadable folder", () => {
        show([source({ name: "Locked", kind: "folder", count: 0, unreadable: true })]);

        expect(row("Locked")).toHaveTextContent("Can't read this folder");
    });

    it("removes a source from its row's button", () => {
        (removeFromSet as Mock).mockResolvedValue({ revision: 1, sources: [heic], total: 1 });
        show([holiday, heic]);

        fireEvent.click(screen.getByRole("button", { name: "Remove Holiday 2025" }));

        expect(removeFromSet).toHaveBeenCalledExactlyOnceWith("/Users/me/Pictures/Holiday 2025");
    });

    it("ends with an add-more row that opens the Add to set menu", async () => {
        show([holiday]);
        const addMore = screen.getByRole("button", { name: "Drop or click to add more files or folders" });

        fireEvent.click(addMore, { detail: 1, clientX: 10, clientY: 5 });

        const menu = await screen.findByRole("menu", { name: "Add to set" });
        expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
        expect(screen.getByRole("button", { name: /add more/, hidden: true })).toHaveAttribute("aria-expanded", "true");
    });

    it("keeps the add-more row outside the scrolling rows", () => {
        show([holiday, heic]);

        const list = screen.getByRole("list", { name: "Selected sources" });
        expect(list).toHaveClass("overflow-y-auto");
        expect(list).not.toContainElement(screen.getByRole("button", { name: /add more/ }));
    });

    it("ends with Clear all beside the add-more button, past a divider", () => {
        show([holiday]);

        const addMore = screen.getByRole("button", { name: "Drop or click to add more files or folders" });
        const clearAll = screen.getByRole("button", { name: "Clear all" });
        const divider = addMore.nextElementSibling;
        expect(addMore.parentElement).toBe(clearAll.parentElement);
        expect(addMore).toHaveClass("flex-1");
        expect(divider).toHaveAttribute("aria-hidden", "true");
        expect(divider?.nextElementSibling).toBe(clearAll);
        expect(clearAll).not.toHaveAttribute("aria-haspopup");
    });

    it("clears the set from Clear all, then reports it", () => {
        (clearSet as Mock).mockResolvedValue({ revision: 1, sources: [], total: 0 });
        const onCleared = vi.fn();
        show([holiday, heic], onCleared);

        fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

        expect(clearSet).toHaveBeenCalledOnce();
        expect(onCleared).toHaveBeenCalledOnce();
        expect(screen.queryAllByRole("listitem")).toEqual([]);
    });
});
