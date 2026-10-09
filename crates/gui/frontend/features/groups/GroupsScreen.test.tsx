import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import { type GroupFile, type ScanGroup, startScan } from "@/ipc/scan";
import type { SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { restoreMedia, trashMedia } from "@/ipc/trash";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { GroupsDeletionNotice } from "./GroupsDeletionNotice";
import { GroupsScreen } from "./GroupsScreen";
import { DEFAULT_RULES, moveRule, type Rule } from "./rules";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/set", () => ({
    addToSet: vi.fn(),
    removeFromSet: vi.fn(),
    rescanSet: vi.fn(),
    listSetMedia: vi.fn(),
    displayPath: vi.fn(async (path: string) => path),
}));
vi.mock("@/ipc/open", () => ({ openMedia: vi.fn(), revealMedia: vi.fn() }));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn(), restoreMedia: vi.fn() }));

const mockedStart = startScan as Mock;
const mockedTrash = trashMedia as Mock;
const mockedRestore = restoreMedia as Mock;

const groupFile = (path: string): GroupFile => ({ path, type: "image", width: 4032, height: 3024, size: 4_800_000 });

/** A group of `size` files under `/p/<name>`. */
const group = (name: string, size: number): ScanGroup => ({
    files: Array.from({ length: size }, (_, i) => groupFile(`/p/${name}/${String(i).padStart(2, "0")}.jpg`)),
});

const skipped = (path: string) => ({ path, message: `failed to read ${path}` });

/** Show the groups screen's state as a scan of `scanned` files at `threshold` that found `groups` leaves it. */
const finished = (groups: ScanGroup[], { scanned = 48, threshold = 85, unread = 0 } = {}) =>
    useScanStore.setState({
        status: "done",
        heading: { count: scanned, set: "Holiday 2025", kinds: "images", threshold },
        result: { groups, skipped: Array.from({ length: unread }, (_, i) => skipped(`/p/bad${i}.jpg`)) },
    });

/** The summary in the groups toolbar. */
const summaryText = () => screen.getByTitle(/ · threshold \d+%/).textContent;

beforeEach(() => {
    mockedStart.mockReset();
    useScanStore.setState(useScanStore.getInitialState(), true);
    useScreenStore.setState(useScreenStore.getInitialState(), true);
    useSettingsStore.setState(SETTINGS_DEFAULTS);
});

describe("Groups screen", () => {
    it("shows the toolbar and every group, with Review as the current step, once a scan finishes", async () => {
        let finish: (result: unknown) => void = () => {};
        mockedStart.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const files: MediaFile[] = ["a", "b"].map((name) => ({
            path: `/p/${name}.jpg`,
            name,
            type: "image",
            size: 1,
            identity: `id-${name}`,
        }));
        useGalleryStore.setState({ listing: { status: "ready", revision: 1, files }, threshold: 85 });
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));
        act(() => useScanStore.getState().start());

        const groups = Array.from({ length: 7 }, (_, i) => group(`g${i}`, i < 4 ? 3 : 2));
        await act(async () => finish({ groups, skipped: [] }));

        expect(screen.getAllByRole("region", { name: /^Group \d$/ })).toHaveLength(7);
        expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New comparison" })).toBeInTheDocument();
        expect(summaryText()).toBe("18 similar files in 7 groups · 2 scanned · threshold 85%");
        const progress = screen.getByRole("navigation", { name: "Progress" });
        expect(within(progress).getByText("Review").closest("li")).toHaveAttribute("aria-current", "step");
    });

    it("shows the same groups and threshold after Settings, whatever changed there", () => {
        finished([group("a", 2), group("b", 3)], { threshold: 85 });
        render(<App />);
        act(() => useScreenStore.getState().show("groups"));

        act(() => useScreenStore.getState().openSettings());
        act(() => useSettingsStore.getState().update({ matchThreshold: 90 }));
        act(() => useScreenStore.getState().closeSettings());

        expect(screen.getAllByRole("region", { name: /^Group \d$/ })).toHaveLength(2);
        expect(summaryText()).toBe("5 similar files in 2 groups · 48 scanned · threshold 85%");
    });

    it("cuts the summary short with an ellipsis, and reads the unreadable files", () => {
        finished([group("a", 2)], { scanned: 10, threshold: 90, unread: 3 });
        render(<GroupsScreen />);

        const summary = screen.getByText(
            "2 similar files in 1 group · 10 scanned · threshold 90% · 3 couldn't be read",
        );
        expect(summary).toHaveClass("truncate");
    });

    it("shows the best file, and no score on the others", () => {
        finished([
            {
                files: [
                    groupFile("/p/IMG_2041 (1).jpg"),
                    { ...groupFile("/p/IMG_2041-edit.jpg"), width: 2048, height: 1536 },
                    groupFile("/p/IMG_2041.jpg"),
                ],
            },
        ]);
        render(<GroupsScreen />);

        const card = screen.getByRole("region", { name: "Group 1" });
        const tile = (name: string) => within(card).getByText(name).closest("[data-path]") as HTMLElement;
        expect(within(tile("IMG_2041.jpg")).getByText("Best")).toBeInTheDocument();
        expect(
            within(tile("IMG_2041.jpg")).getByRole("button", { name: "IMG_2041.jpg" }).parentElement,
        ).not.toHaveClass("ring-primary");
        expect(tile("IMG_2041 (1).jpg")).not.toHaveTextContent(/%|best/i);
        expect(tile("IMG_2041-edit.jpg")).not.toHaveTextContent(/%|best/i);
    });

    it("spans a group of 19 files across the full width, with the small groups below it", () => {
        finished([group("a", 19), group("b", 2), group("c", 2)]);
        render(<GroupsScreen />);

        const [large, ...small] = screen.getAllByRole("region", { name: /^Group \d$/ });
        expect(large).toHaveAccessibleName("Group 1");
        expect(large).toHaveClass("w-full");
        expect(large?.querySelector(".grid-cols-8")?.children).toHaveLength(19);
        for (const card of small) expect(card).not.toHaveClass("w-full");
        expect(large?.parentElement).toHaveClass("flex-wrap", "overflow-y-auto");
    });

    it("reads that nothing similar was found, with the files compared and New comparison", () => {
        finished([], { scanned: 48, threshold: 85, unread: 2 });
        render(<GroupsScreen />);

        expect(screen.getByRole("heading", { level: 2, name: "No similar files found" })).toBeInTheDocument();
        expect(screen.getByText("The 46 files compared are unique at the 85% threshold.")).toBeInTheDocument();
        expect(summaryText()).toBe("No similar files found · 48 scanned · threshold 85% · 2 couldn't be read");
        expect(screen.getAllByRole("button", { name: "New comparison" })).toHaveLength(2);
        expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });
});

describe("Leaving the groups", () => {
    const folder: SourceView = {
        path: "/p/Holiday 2025",
        name: "Holiday 2025",
        location: "~/Holiday 2025",
        kind: "folder",
        count: 3,
        size: 3,
        unreadable: false,
        pending: false,
    };
    const files: MediaFile[] = ["a", "b", "c"].map((name) => ({
        path: `/p/Holiday 2025/${name}.jpg`,
        name,
        type: "image",
        size: 1,
        identity: `id-${name}`,
    }));

    beforeEach(() => {
        useHomeStore.setState({
            view: { revision: 1, sources: [folder], total: files.length },
            sources: [folder],
            rescans: 0,
        });
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useGalleryStore.setState({ listing: { status: "ready", revision: 1, files }, filter: "both", threshold: 72 });
    });

    it("goes Back to the gallery as it was, with focus on Compare", async () => {
        const videos = files.map(
            (file): MediaFile => ({ ...file, path: file.path.replace(".jpg", ".mp4"), type: "video" }),
        );
        useGalleryStore.setState({ listing: { status: "ready", revision: 1, files: videos }, filter: "videos" });
        const gallery = useGalleryStore.getState();
        render(<App />);
        act(() => useScreenStore.getState().show("groups"));
        act(() => finished([group("a", 2)]));

        fireEvent.click(screen.getByRole("button", { name: "Back" }));

        expect(screen.getByRole("tab", { name: /^Videos/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByText("72%")).toBeInTheDocument();
        expect(useGalleryStore.getState()).toBe(gallery);
        expect(useScanStore.getState().result).toBeUndefined();
        await waitFor(() => expect(screen.getByRole("button", { name: "Compare 3 files" })).toHaveFocus());
    });

    it.each(["toolbar", "empty state"])(
        "shows Home with the set unchanged on New comparison from the %s, with focus on Continue",
        async (where) => {
            render(<App />);
            act(() => useScreenStore.getState().show("groups"));
            act(() => finished(where === "toolbar" ? [group("a", 2)] : []));

            const buttons = screen.getAllByRole("button", { name: "New comparison" });
            fireEvent.click((where === "toolbar" ? buttons[0] : buttons.at(-1)) as HTMLElement);

            expect(useScreenStore.getState().screen).toBe("home");
            expect(useHomeStore.getState().sources).toEqual([folder]);
            expect(screen.getAllByText("Holiday 2025").length).toBeGreaterThan(0);
            expect(useScanStore.getState().result).toBeUndefined();
            await waitFor(() => expect(screen.getByRole("button", { name: /^Continue/ })).toHaveFocus());
        },
    );
});

describe("Marking", () => {
    /** The footer's text. */
    const footer = () => screen.getByRole("status").textContent;
    const NOTHING = "Nothing marked yet. Tick files, or let Auto-select pick the extras for you.";
    /** The labels of the checked boxes, in order. */
    const checked = () =>
        screen
            .getAllByRole("checkbox")
            .filter((box) => box.getAttribute("aria-checked") === "true")
            .map((box) => box.getAttribute("aria-label"));
    /** The mark checkbox of the file at `path`, looked up in its tile, since names repeat across groups. */
    const box = (path: string) =>
        within(document.querySelector(`[data-path="${path}"]`) as HTMLElement).getByRole("checkbox");

    /** Every group's files are 4,800,000 bytes, so the best is each group's first file. */
    const GROUPS = Array.from({ length: 7 }, (_, i) => group(`g${i}`, i < 4 ? 3 : 2));

    it("opens with nothing marked", () => {
        finished(GROUPS);
        render(<GroupsScreen />);

        expect(checked()).toEqual([]);
        expect(footer()).toBe(NOTHING);
        expect(screen.getByRole("button", { name: "Move 0 to Trash…" })).toBeDisabled();
    });

    it("marks every file but the best ones on Auto-select, replacing a mark on a best file", () => {
        finished(GROUPS);
        render(<GroupsScreen />);
        fireEvent.click(box("/p/g0/00.jpg"));

        fireEvent.click(screen.getByRole("button", { name: "Auto-select" }));

        const marks = useScanStore.getState().marks;
        expect(marks.size).toBe(11);
        expect(marks.has("/p/g0/00.jpg")).toBe(false);
        expect(footer()).toBe("11 files marked for deletion · 52.8 MB will be freed");
        expect(screen.getByRole("button", { name: "Move 11 to Trash…" })).toBeEnabled();
    });

    it("keeps only the best of one group on its Keep best only, leaving the others alone", () => {
        finished(GROUPS);
        render(<GroupsScreen />);
        fireEvent.click(box("/p/g1/00.jpg"));
        fireEvent.click(box("/p/g0/00.jpg"));

        const card = screen.getByRole("region", { name: "Group 1" });
        fireEvent.click(within(card).getByRole("button", { name: "Keep best only" }));

        expect([...useScanStore.getState().marks].sort()).toEqual(["/p/g0/01.jpg", "/p/g0/02.jpg", "/p/g1/00.jpg"]);
        expect(footer()).toBe("3 files marked for deletion · 14.4 MB will be freed");
    });

    it("unmarks everything on Clear marks", () => {
        finished(GROUPS);
        render(<GroupsScreen />);
        fireEvent.click(screen.getByRole("button", { name: "Auto-select" }));

        fireEvent.click(screen.getByRole("button", { name: "Clear marks" }));

        expect(checked()).toEqual([]);
        expect(footer()).toBe(NOTHING);
    });

    it("marks a file when its box is checked, and unmarks it when unchecked", () => {
        finished(GROUPS);
        render(<GroupsScreen />);

        fireEvent.click(box("/p/g2/01.jpg"));

        expect(checked()).toEqual(["Mark 01.jpg for deletion"]);
        expect(footer()).toBe("1 file marked for deletion · 4.8 MB will be freed");

        fireEvent.click(box("/p/g2/01.jpg"));

        expect(checked()).toEqual([]);
    });

    it("opens the confirmation when the footer's button is activated, keeping the marks", () => {
        finished(GROUPS);
        useScanStore.setState({ files: scannedOf(GROUPS) });
        render(<GroupsScreen />);
        fireEvent.click(box("/p/g2/01.jpg"));

        fireEvent.click(screen.getByRole("button", { name: "Move 1 to Trash…" }));

        expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Move 1 file to Trash?");
        expect([...useScanStore.getState().marks]).toEqual(["/p/g2/01.jpg"]);
    });

    it("shows no footer, Clear marks or Auto-select without a group", () => {
        finished([]);
        render(<GroupsScreen />);

        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Deletion" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Clear marks" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Auto-select" })).not.toBeInTheDocument();
    });
});

/** The scanned files of `groups`, named after the last part of their paths. */
const scannedOf = (groups: ScanGroup[]): MediaFile[] =>
    groups.flatMap(({ files }) =>
        files.map((file) => ({
            path: file.path,
            name: file.path.split("/").pop() ?? file.path,
            type: file.type,
            size: file.size,
            identity: `id-${file.path}`,
        })),
    );

/** Shows the groups screen for `groups`, with their files scanned. */
const show = (groups: ScanGroup[]) => {
    finished(groups);
    useScanStore.setState({ files: scannedOf(groups) });
    render(<GroupsScreen />);
};

/** The thumbnail button of the file at `path`, looked up by path, since names repeat across groups. */
const thumb = (path: string) => document.querySelector(`[data-select="${path}"]`) as HTMLElement;
/** The mark checkbox of the file at `path`. */
const box = (path: string) =>
    within(document.querySelector(`[data-path="${path}"]`) as HTMLElement).getByRole("checkbox");
/** The paths of the tiles showing the lime ring. */
const ringed = () =>
    [...document.querySelectorAll<HTMLElement>("[data-select]")]
        .filter((button) => button.parentElement?.classList.contains("ring-primary"))
        .map((button) => button.dataset.select);
const dialog = () => screen.getByRole("dialog");

/** Group 1 of three copies, `IMG_2041-edit.jpg` 1,100,000 bytes, then a group of two. */
const COPIES: ScanGroup[] = [
    {
        files: [
            groupFile("/p/IMG_2041.jpg"),
            groupFile("/p/IMG_2041 (1).jpg"),
            { ...groupFile("/p/IMG_2041-edit.jpg"), size: 1_100_000 },
        ],
    },
    group("b", 2),
];

describe("Selecting a tile", () => {
    it("selects a tile on a single click, opening nothing, and moves the lime ring on another", () => {
        show(COPIES);
        expect(ringed()).toEqual([]);

        fireEvent.click(thumb("/p/IMG_2041 (1).jpg"));

        expect(ringed()).toEqual(["/p/IMG_2041 (1).jpg"]);
        expect(thumb("/p/IMG_2041 (1).jpg")).toHaveFocus();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        fireEvent.click(thumb("/p/IMG_2041.jpg"));

        expect(ringed()).toEqual(["/p/IMG_2041.jpg"]);
    });

    it("marks a file on a click on its checkbox, leaving the selection and opening nothing", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041.jpg"));

        fireEvent.click(box("/p/IMG_2041 (1).jpg"));

        expect(useScanStore.getState().marks).toEqual(new Set(["/p/IMG_2041 (1).jpg"]));
        expect(ringed()).toEqual(["/p/IMG_2041.jpg"]);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("makes the groups area one tab stop, which selects Group 1's first file when tabbed onto", () => {
        show(COPIES);

        const stops = [...document.querySelectorAll<HTMLElement>("[data-select]")].filter(
            (button) => button.tabIndex === 0,
        );
        expect(stops).toEqual([thumb("/p/IMG_2041.jpg")]);
        expect(screen.getAllByRole("checkbox").every((checkbox) => checkbox.tabIndex === -1)).toBe(true);

        act(() => thumb("/p/IMG_2041.jpg").focus());

        expect(ringed()).toEqual(["/p/IMG_2041.jpg"]);
    });

    it("moves the selection across groups with → and ←, stopping at either end", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041-edit.jpg"));

        fireEvent.keyDown(thumb("/p/IMG_2041-edit.jpg"), { key: "ArrowRight" });

        expect(ringed()).toEqual(["/p/b/00.jpg"]);
        expect(thumb("/p/b/00.jpg")).toHaveFocus();
        expect(thumb("/p/b/00.jpg")).toHaveAttribute("tabindex", "0");

        fireEvent.keyDown(thumb("/p/b/00.jpg"), { key: "ArrowLeft" });

        expect(ringed()).toEqual(["/p/IMG_2041-edit.jpg"]);

        fireEvent.click(thumb("/p/b/01.jpg"));
        fireEvent.keyDown(thumb("/p/b/01.jpg"), { key: "ArrowRight" });

        expect(ringed()).toEqual(["/p/b/01.jpg"]);

        fireEvent.click(thumb("/p/IMG_2041.jpg"));
        fireEvent.keyDown(thumb("/p/IMG_2041.jpg"), { key: "ArrowLeft" });

        expect(ringed()).toEqual(["/p/IMG_2041.jpg"]);
    });

    it("moves the selection to the tile below on ↓, by where the tiles are on screen", () => {
        // Group 1 and Group 2 side by side, and Group 3 on the next line under Group 1.
        const where: Record<string, [left: number, top: number]> = {
            "/p/IMG_2041.jpg": [0, 0],
            "/p/IMG_2041 (1).jpg": [172, 0],
            "/p/IMG_2041-edit.jpg": [344, 0],
            "/p/b/00.jpg": [568, 0],
            "/p/b/01.jpg": [740, 0],
            "/p/c/00.jpg": [0, 220],
            "/p/c/01.jpg": [172, 220],
            "/p/c/02.jpg": [344, 220],
        };
        const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const [left, top] = where[(this as HTMLElement).dataset.select ?? ""] ?? [0, 0];
            return {
                left,
                top,
                right: left + 160,
                bottom: top + 120,
                x: left,
                y: top,
                width: 160,
                height: 120,
            } as DOMRect;
        });
        const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
        try {
            show([...COPIES, group("c", 3)]);
            fireEvent.click(thumb("/p/IMG_2041 (1).jpg"));

            fireEvent.keyDown(thumb("/p/IMG_2041 (1).jpg"), { key: "ArrowDown" });

            expect(ringed()).toEqual(["/p/c/01.jpg"]);
            expect(thumb("/p/c/01.jpg")).toHaveFocus();
            // The whole tile, with its name and details line, not only the thumbnail.
            expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
            expect(scroll.mock.contexts.at(-1)).toBe(document.querySelector('[data-path="/p/c/01.jpg"]'));

            fireEvent.keyDown(thumb("/p/c/01.jpg"), { key: "ArrowDown" });

            expect(ringed()).toEqual(["/p/c/01.jpg"]);
        } finally {
            rect.mockRestore();
            scroll.mockRestore();
        }
    });

    it("marks and unmarks the selected file on Space, with the footer following", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041 (1).jpg"));

        const space = fireEvent.keyDown(thumb("/p/IMG_2041 (1).jpg"), { key: " " });

        expect(space).toBe(false);
        expect(box("/p/IMG_2041 (1).jpg")).toBeChecked();
        expect(screen.getByRole("status")).toHaveTextContent("1 file marked for deletion · 4.8 MB will be freed");

        fireEvent.keyDown(thumb("/p/IMG_2041 (1).jpg"), { key: " " });

        expect(box("/p/IMG_2041 (1).jpg")).not.toBeChecked();
        expect(useScanStore.getState().marks.size).toBe(0);
    });

    it.each(["Clear marks", "Auto-select", "Keep best only"])(
        "keeps focus on the selected tile when %s is clicked, so the arrow keys still move it",
        (name) => {
            show(COPIES);
            fireEvent.click(thumb("/p/IMG_2041.jpg"));
            const button = within(document.body).getAllByRole("button", { name })[0] as HTMLElement;

            // jsdom moves no focus on a press, so this checks what keeps the browser from moving it.
            expect(fireEvent.mouseDown(button)).toBe(false);
            fireEvent.click(button);

            expect(thumb("/p/IMG_2041.jpg")).toHaveFocus();
            fireEvent.keyDown(thumb("/p/IMG_2041.jpg"), { key: "ArrowRight" });
            expect(ringed()).toEqual(["/p/IMG_2041 (1).jpg"]);
        },
    );

    it("clears the selection on Escape", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041 (1).jpg"));

        fireEvent.keyDown(thumb("/p/IMG_2041 (1).jpg"), { key: "Escape" });

        expect(ringed()).toEqual([]);
        expect(thumb("/p/IMG_2041.jpg")).toHaveAttribute("tabindex", "0");
    });

    it("clears the selection on a click on the groups area's empty space", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041 (1).jpg"));

        // Group 2's card, beside its tiles: jsdom has no layout, so a click on the area itself reads as one on its scrollbar.
        fireEvent.click(screen.getByRole("region", { name: "Group 2" }));

        expect(ringed()).toEqual([]);
    });

    it("forgets the selection when the groups screen is shown again", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041 (1).jpg"));
        cleanup();

        render(<GroupsScreen />);

        expect(ringed()).toEqual([]);
    });
});

describe("Opening a file's details", () => {
    it("opens the details of the file whose thumbnail is double-clicked", () => {
        show(COPIES);

        fireEvent.doubleClick(thumb("/p/IMG_2041 (1).jpg"));

        expect(screen.getByRole("dialog", { name: "Media details: IMG_2041 (1).jpg" })).toBeInTheDocument();
        expect(within(dialog()).getByText("Group 1 · 2 of 3")).toBeInTheDocument();
    });

    it("opens the details of the selected file on Enter", () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041.jpg"));

        const enter = fireEvent.keyDown(thumb("/p/IMG_2041.jpg"), { key: "Enter" });

        expect(enter).toBe(false);
        expect(screen.getByRole("dialog", { name: "Media details: IMG_2041.jpg" })).toBeInTheDocument();
    });

    it("opens nothing on a click on the mark checkbox", () => {
        show(COPIES);

        fireEvent.click(box("/p/IMG_2041 (1).jpg"));

        expect(useScanStore.getState().marks).toEqual(new Set(["/p/IMG_2041 (1).jpg"]));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a mark made in the dialog on the tile and the footer once it closes", async () => {
        show(COPIES);
        fireEvent.doubleClick(thumb("/p/IMG_2041-edit.jpg"));

        fireEvent.click(within(dialog()).getByRole("button", { name: "Mark for deletion" }));
        fireEvent.keyDown(dialog(), { key: "Escape" });

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        const tile = document.querySelector('[data-path="/p/IMG_2041-edit.jpg"]') as HTMLElement;
        expect(within(tile).getByText("Delete")).toBeInTheDocument();
        expect(box("/p/IMG_2041-edit.jpg")).toBeChecked();
        expect(screen.getByRole("status")).toHaveTextContent("1 file marked for deletion · 1.1 MB will be freed");
        await waitFor(() => expect(thumb("/p/IMG_2041-edit.jpg")).toHaveFocus());
    });

    it("selects and focuses the tile of the file last shown once it closes", async () => {
        show([group("a", 19), group("b", 2)]);
        fireEvent.doubleClick(thumb("/p/a/00.jpg"));

        for (let i = 0; i < 11; i++) fireEvent.click(within(dialog()).getByRole("button", { name: "Next file" }));
        expect(within(dialog()).getByText("Group 1 · 12 of 19")).toBeInTheDocument();

        fireEvent.keyDown(dialog(), { key: "Escape" });

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(ringed()).toEqual(["/p/a/11.jpg"]);
        await waitFor(() => expect(thumb("/p/a/11.jpg")).toHaveFocus());
    });

    describe("a click on the backdrop", () => {
        const backdrop = () => document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;

        /** Double-click the thumbnail of `IMG_2041 (1).jpg`, then press on the backdrop `elapsed` ms later. */
        const pressBackdropAfter = async (elapsed: number) => {
            const now = vi.spyOn(performance, "now").mockReturnValue(1000);
            show(COPIES);
            fireEvent.doubleClick(thumb("/p/IMG_2041 (1).jpg"));
            // Radix starts listening for outside presses a tick after opening.
            await act(() => new Promise((resolve) => setTimeout(resolve)));
            now.mockReturnValue(1000 + elapsed);

            // Radix dismisses a primary-button press outside once its click follows.
            fireEvent.pointerDown(backdrop());
            fireEvent.click(backdrop());
        };

        it("closes it, selecting the tile of the file last shown", async () => {
            await pressBackdropAfter(600);

            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(ringed()).toEqual(["/p/IMG_2041 (1).jpg"]);
        });

        it("keeps it open when it is the second click of the double click that opened it", async () => {
            await pressBackdropAfter(200);

            expect(dialog()).toHaveAccessibleName("Media details: IMG_2041 (1).jpg");
        });
    });

    it("shows the 9th to 15th files in the strip for the 12th file of a 19-file group", () => {
        show([group("a", 19)]);

        fireEvent.doubleClick(thumb("/p/a/11.jpg"));

        const strip = within(dialog())
            .getAllByRole("button", { name: /^Show \d+\.jpg$/ })
            .map((button) => button.getAttribute("aria-label"));
        expect(strip).toEqual(Array.from({ length: 7 }, (_, i) => `Show ${String(i + 8).padStart(2, "0")}.jpg`));
        expect(within(dialog()).getByRole("button", { name: "Show 11.jpg" })).toHaveAttribute("aria-current", "true");
    });
});

/** The default rules with "Oldest creation date" on and first. */
const CREATED_FIRST: Rule[] = moveRule(
    DEFAULT_RULES.map((rule) => (rule.id === "created" ? { ...rule, on: true } : rule)),
    3,
    0,
);

/** The spec's one group: `DSC_0193.HEIC`, larger and newer, and `DSC_0193.jpg`, both 4032 × 3024. */
const DSC: ScanGroup[] = [
    {
        files: [
            { ...groupFile("/p/DSC_0193.HEIC"), size: 4_100_000, created: "2025-06-02T00:00:00Z" },
            { ...groupFile("/p/DSC_0193.jpg"), size: 3_200_000, created: "2025-06-01T00:00:00Z" },
        ],
    },
];

/** Whether the tile of the file at `path` shows the Best badge. */
const isBest = (path: string) =>
    within(document.querySelector(`[data-path="${path}"]`) as HTMLElement).queryByText("Best") !== null;

describe("Best files from the saved rules", () => {
    it("picks the older file, and Auto-select marks the other, with the creation date on and first", () => {
        useSettingsStore.setState({ autoSelectRules: CREATED_FIRST });
        show(DSC);

        expect(isBest("/p/DSC_0193.jpg")).toBe(true);
        expect(isBest("/p/DSC_0193.HEIC")).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Auto-select" }));

        expect([...useScanStore.getState().marks]).toEqual(["/p/DSC_0193.HEIC"]);
    });

    it("moves the Best badge when the rules change, leaving the marks as they were", () => {
        show(DSC);
        expect(isBest("/p/DSC_0193.HEIC")).toBe(true);
        fireEvent.click(box("/p/DSC_0193.HEIC"));

        act(() => useSettingsStore.getState().update({ autoSelectRules: CREATED_FIRST }));

        expect(isBest("/p/DSC_0193.jpg")).toBe(true);
        expect([...useScanStore.getState().marks]).toEqual(["/p/DSC_0193.HEIC"]);
    });

    it("moves the details dialog's Recommended keep with the best file", () => {
        show(DSC);
        fireEvent.doubleClick(thumb("/p/DSC_0193.jpg"));
        expect(within(dialog()).queryByText("Recommended keep")).not.toBeInTheDocument();

        act(() => useSettingsStore.getState().update({ autoSelectRules: CREATED_FIRST }));

        expect(within(dialog()).getByText("Recommended keep")).toBeInTheDocument();
    });
});

describe("Choosing the Auto-select rules", () => {
    // While the menu or the dialog is open, the rest of the page is hidden from assistive technology.
    const chevron = () => screen.getByRole("button", { name: "More auto-select options", hidden: true });
    const rulesDialog = () => screen.getByRole("dialog", { name: "Auto-select" });
    const order = () =>
        within(rulesDialog())
            .getAllByRole("switch")
            .map((s) => s.getAttribute("aria-label"));

    /** Opens the Auto-select rules dialog from the chevron's menu, as clicks do. */
    const openRules = async () => {
        fireEvent.pointerDown(chevron(), { button: 0, ctrlKey: false });
        const menu = await screen.findByRole("menu", { name: "Auto-select options" });
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Choose rules…" }));
        return screen.findByRole("dialog", { name: "Auto-select" });
    };

    /** Lets dnd-kit's keyboard sensor start listening, which it does a tick after a row is lifted. */
    const tick = () => act(() => new Promise((resolve) => setTimeout(resolve)));
    const press = async (code: string) => {
        await act(async () => {
            fireEvent.keyDown(document.activeElement ?? document.body, { key: code === "Space" ? " " : code, code });
        });
        await tick();
    };

    /** Turns "Oldest creation date" on and moves it first from the keyboard, as the spec's scenario does. */
    const createdFirst = async () => {
        // jsdom has no layout: each rule's row stands 60 px tall, one under the other.
        const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const rows = [...document.querySelectorAll('[role="dialog"] li')];
            const index = rows.indexOf(this);
            const top = Math.max(index, 0) * 60;
            const height = index < 0 ? 0 : 60;
            return { top, bottom: top + height, left: 0, right: 560, x: 0, y: top, width: 560, height } as DOMRect;
        });
        try {
            fireEvent.click(within(rulesDialog()).getByRole("switch", { name: "Oldest creation date" }));
            act(() => within(rulesDialog()).getByRole("button", { name: "Reorder Oldest creation date" }).focus());
            await press("Space");
            for (let i = 0; i < 3; i++) await press("ArrowUp");
            await press("Space");
        } finally {
            rect.mockRestore();
        }
    };

    it("previews, then applies the rules: new best file, marks replaced, and the footer following", async () => {
        show(DSC);
        await openRules();
        const previewText = () => within(rulesDialog()).getByText(/^Will mark/).textContent;
        expect(previewText()).toBe("Will mark 1 of 2 grouped files · 3.2 MB freed");

        await createdFirst();

        expect(order()[0]).toBe("Oldest creation date");
        expect(previewText()).toBe("Will mark 1 of 2 grouped files · 4.1 MB freed");

        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Apply to 1 group" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(isBest("/p/DSC_0193.jpg")).toBe(true);
        expect(box("/p/DSC_0193.jpg")).not.toBeChecked();
        expect(box("/p/DSC_0193.HEIC")).toBeChecked();
        expect(screen.getByRole("status")).toHaveTextContent("1 file marked for deletion · 4.1 MB will be freed");
    });

    it("saves the applied rules, and opens with them again", async () => {
        show(DSC);
        await openRules();
        await createdFirst();

        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Apply to 1 group" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        expect(useSettingsStore.getState().autoSelectRules).toEqual(CREATED_FIRST);
        await openRules();
        expect(order()[0]).toBe("Oldest creation date");
        expect(within(rulesDialog()).getByRole("switch", { name: "Oldest creation date" })).toBeChecked();
    });

    it("keeps the applied rules for the next scan's result", async () => {
        show(DSC);
        await openRules();
        fireEvent.click(within(rulesDialog()).getByRole("switch", { name: "Largest file size" }));
        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Apply to 1 group" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        // Two files that tie on everything but size: with "Largest file size" off, the path that sorts first wins.
        act(() => useScanStore.getState().newComparison());
        act(() =>
            finished([
                {
                    files: [
                        { ...groupFile("/p/a.jpg"), size: 1_000_000 },
                        { ...groupFile("/p/b.jpg"), size: 5_000_000 },
                    ],
                },
            ]),
        );

        expect(isBest("/p/a.jpg")).toBe(true);
        expect(isBest("/p/b.jpg")).toBe(false);
        await openRules();
        expect(within(rulesDialog()).getByRole("switch", { name: "Largest file size" })).not.toBeChecked();
    });

    it("changes no mark, best file or setting on Cancel", async () => {
        show(DSC);
        fireEvent.click(box("/p/DSC_0193.jpg"));
        await openRules();
        fireEvent.click(within(rulesDialog()).getByRole("switch", { name: "Largest file size" }));

        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Cancel" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect([...useScanStore.getState().marks]).toEqual(["/p/DSC_0193.jpg"]);
        expect(isBest("/p/DSC_0193.HEIC")).toBe(true);
        expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);
    });

    it("leaves <body> clickable once the dialog opens from the menu", async () => {
        show(DSC);

        await openRules();

        // A modal dialog sets `none` on <body> while open, and keeps itself clickable.
        expect(rulesDialog().closest("[style*='pointer-events: auto']")).not.toBeNull();
        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(document.body.style.pointerEvents).not.toBe("none");
    });

    it("hands focus back to the selected tile after the menu closes on Escape", async () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041.jpg"));
        fireEvent.pointerDown(chevron(), { button: 0, ctrlKey: false });
        const menu = await screen.findByRole("menu", { name: "Auto-select options" });

        fireEvent.keyDown(menu, { key: "Escape" });

        await waitFor(() => expect(thumb("/p/IMG_2041.jpg")).toHaveFocus());
        fireEvent.keyDown(thumb("/p/IMG_2041.jpg"), { key: "ArrowRight" });
        expect(ringed()).toEqual(["/p/IMG_2041 (1).jpg"]);
    });

    it("hands focus back to the selected tile after the dialog's Cancel", async () => {
        show(COPIES);
        fireEvent.click(thumb("/p/IMG_2041.jpg"));
        await openRules();

        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Cancel" }));

        await waitFor(() => expect(thumb("/p/IMG_2041.jpg")).toHaveFocus());
        fireEvent.keyDown(thumb("/p/IMG_2041.jpg"), { key: "ArrowRight" });
        expect(ringed()).toEqual(["/p/IMG_2041 (1).jpg"]);
    });

    it("puts focus on the chevron after Apply with no tile selected", async () => {
        show(COPIES);
        await openRules();

        fireEvent.click(within(rulesDialog()).getByRole("button", { name: "Apply to 2 groups" }));

        await waitFor(() => expect(chevron()).toHaveFocus());
    });
});

describe("Removing marked files", () => {
    /** 7 groups holding 18 files of 4,800,000 bytes, each one's first file its best. */
    const GROUPS = Array.from({ length: 7 }, (_, i) => group(`g${i}`, i < 4 ? 3 : 2));
    const trashed = (count: number) => Array.from({ length: count }, () => ({ status: "trashed" }));
    const groupNames = () => screen.getAllByRole("region", { name: /^Group \d$/ }).map((card) => card.ariaLabel);
    const tilesOf = (name: string) =>
        [...screen.getByRole("region", { name }).querySelectorAll<HTMLElement>("[data-path]")].map(
            (tile) => tile.dataset.path,
        );
    const footer = () => within(screen.getByRole("region", { name: "Deletion" })).getByRole("status").textContent;

    /** Activates the footer's button, with confirmation off, and lets the removal finish. */
    const removeMarked = async () => {
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /^Move \d+ to Trash$/ }));
        });
    };

    beforeEach(() => {
        mockedTrash.mockReset();
        mockedRestore.mockReset();
        useSettingsStore.setState({ confirmDeletion: false });
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    });

    it("drops a group left with one file, and numbers the rest from 1", async () => {
        show(GROUPS);
        fireEvent.click(box("/p/g0/01.jpg"));
        fireEvent.click(box("/p/g0/02.jpg"));
        mockedTrash.mockResolvedValue(trashed(2));

        await removeMarked();

        expect(groupNames()).toEqual(["Group 1", "Group 2", "Group 3", "Group 4", "Group 5", "Group 6"]);
        expect(tilesOf("Group 1")).toEqual(["/p/g1/00.jpg", "/p/g1/01.jpg", "/p/g1/02.jpg"]);
        expect(summaryText()).toBe("15 similar files in 6 groups · 48 scanned · threshold 85%");
        expect(footer()).toBe("Nothing marked for deletion.");
    });

    it("keeps a file that couldn't be moved marked in its group", async () => {
        show(GROUPS);
        fireEvent.click(box("/p/g0/01.jpg"));
        fireEvent.click(box("/p/g0/02.jpg"));
        mockedTrash.mockResolvedValue([{ status: "trashed" }, { status: "failed", reason: "changed", message: "x" }]);

        await removeMarked();

        expect(tilesOf("Group 1")).toEqual(["/p/g0/00.jpg", "/p/g0/02.jpg"]);
        expect(box("/p/g0/02.jpg")).toHaveAttribute("aria-checked", "true");
        expect(footer()).toBe("1 file marked for deletion · 4.8 MB will be freed");
    });

    it("leaves no tile selected when the selected file is removed", async () => {
        show(GROUPS);
        fireEvent.click(thumb("/p/g0/01.jpg"));
        fireEvent.click(box("/p/g0/01.jpg"));
        expect(ringed()).toEqual(["/p/g0/01.jpg"]);
        mockedTrash.mockResolvedValue(trashed(1));

        await removeMarked();

        expect(ringed()).toEqual([]);
    });

    it("marks only the files still shown on Auto-select after a removal", async () => {
        show(GROUPS);
        fireEvent.click(box("/p/g0/01.jpg"));
        mockedTrash.mockResolvedValue(trashed(1));
        await removeMarked();

        fireEvent.click(screen.getByRole("button", { name: "Auto-select" }));

        const marks = useScanStore.getState().marks;
        expect(marks.size).toBe(10);
        expect(marks.has("/p/g0/01.jpg")).toBe(false);
    });

    describe("every extra removed", () => {
        const removeEveryExtra = async () => {
            show(GROUPS);
            render(<GroupsDeletionNotice />);
            fireEvent.click(screen.getByRole("button", { name: "Auto-select" }));
            mockedTrash.mockResolvedValue(trashed(11));
            await removeMarked();
        };

        it("reads that no similar file is left, with New comparison, and keeps the footer", async () => {
            await removeEveryExtra();

            expect(screen.getByRole("heading", { level: 2, name: "No similar files left" })).toBeInTheDocument();
            expect(
                screen.getByText("All 7 groups are resolved. The 37 remaining files are unique at the 85% threshold."),
            ).toBeInTheDocument();
            expect(screen.getAllByRole("button", { name: "New comparison" })).toHaveLength(2);
            expect(summaryText()).toBe("No similar files left · 37 files remaining · threshold 85%");
            expect(screen.queryByRole("region", { name: /^Group \d$/ })).not.toBeInTheDocument();
            expect(footer()).toBe("Nothing marked for deletion.");
            expect(screen.getByRole("button", { name: "Move 0 to Trash" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Clear marks" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Auto-select" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "More auto-select options" })).toBeDisabled();
        });

        it("brings the 7 groups back with the files marked on Undo", async () => {
            await removeEveryExtra();
            mockedRestore.mockImplementation(async (identities: string[]) =>
                identities.map((identity) => ({ status: "restored", identity })),
            );

            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Undo moving 11 files to Trash" }));
            });

            expect(groupNames()).toHaveLength(7);
            expect(useScanStore.getState().marks.size).toBe(11);
            expect(footer()).toBe("11 files marked for deletion · 52.8 MB will be freed");
            expect(screen.getAllByRole("status").some((status) => status.textContent === "11 files restored")).toBe(
                true,
            );
        });
    });
});
