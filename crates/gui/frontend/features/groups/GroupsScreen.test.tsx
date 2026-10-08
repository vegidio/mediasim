import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import { type GroupFile, type ScanGroup, startScan } from "@/ipc/scan";
import type { SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { useSettingsStore } from "@/stores/settings";
import { GroupsScreen } from "./GroupsScreen";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));

const mockedStart = startScan as Mock;

const groupFile = (path: string): GroupFile => ({ path, type: "image", width: 4032, height: 3024, size: 4_800_000 });

/** A group of `size` files under `/p/<name>`, every pair scoring `score`. */
const group = (name: string, size: number, score = 0.95): ScanGroup => ({
    files: Array.from({ length: size }, (_, i) => groupFile(`/p/${name}/${String(i).padStart(2, "0")}.jpg`)),
    scores: Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? 1 : score))),
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
const summaryText = () => screen.getByTitle(/ scanned · threshold /).textContent;

beforeEach(() => {
    mockedStart.mockReset();
    useScanStore.setState(useScanStore.getInitialState(), true);
    useScreenStore.setState(useScreenStore.getInitialState(), true);
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
                scores: [
                    [1, 0.95, 1],
                    [0.95, 1, 0.968],
                    [1, 0.968, 1],
                ],
            },
        ]);
        render(<GroupsScreen />);

        const card = screen.getByRole("region", { name: "Group 1" });
        const tile = (name: string) => within(card).getByText(name).closest("[data-path]") as HTMLElement;
        expect(within(tile("IMG_2041.jpg")).getByText("Keep")).toBeInTheDocument();
        expect(within(tile("IMG_2041.jpg")).getByText("best")).toBeInTheDocument();
        expect(tile("IMG_2041 (1).jpg")).not.toHaveTextContent(/%|best/);
        expect(tile("IMG_2041-edit.jpg")).not.toHaveTextContent(/%|best/);
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

    /** Every group's files are 4,800,000 bytes, and with every score equal the best is each group's first file. */
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

    it("keeps the marks when the footer's button is activated", () => {
        finished(GROUPS);
        render(<GroupsScreen />);
        fireEvent.click(box("/p/g2/01.jpg"));

        fireEvent.click(screen.getByRole("button", { name: "Move 1 to Trash…" }));

        expect([...useScanStore.getState().marks]).toEqual(["/p/g2/01.jpg"]);
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
