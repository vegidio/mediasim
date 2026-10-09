import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { cancelScan, startScan } from "@/ipc/scan";
import type { SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { type ScanProgress, useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { ScanScreen } from "./ScanScreen";

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
const mockedCancel = cancelScan as Mock;

const file = (name: string, type: MediaType = "image"): MediaFile => ({
    path: `/Users/ana/Pictures/Holiday 2025/${name}`,
    name,
    type,
    size: 1,
    identity: `id-${name}`,
});

const FILES = [
    file("IMG_3312.jpg"),
    file("IMG_3313.jpg"),
    file("clip.mp4", "video"),
    file("clip2.mp4", "video"),
    file("clip3.mp4", "video"),
    file("IMG_3314.jpg"),
];

const HEADING = { count: 48, set: "Holiday 2025", kinds: "both", threshold: 85 } as const;

/** Show the scan screen's state as a running scan of 48 files would leave it at `progress`. */
const running = (progress: Partial<ScanProgress> = {}) =>
    useScanStore.setState({
        status: "running",
        heading: HEADING,
        files: FILES,
        progress: { done: 0, total: 48, skipped: 0, ...progress },
    });

beforeEach(() => {
    mockedStart.mockReset().mockReturnValue(new Promise(() => {}));
    mockedCancel.mockReset().mockResolvedValue(undefined);
    useScanStore.setState(useScanStore.getInitialState(), true);
    useScreenStore.setState(useScreenStore.getInitialState(), true);
});

describe("Scan screen heading", () => {
    it("reads the number of files, the set, the kinds and the threshold", () => {
        running();
        render(<ScanScreen />);

        expect(screen.getByRole("heading", { level: 1, name: "Comparing 48 files" })).toBeInTheDocument();
        expect(screen.getByText("Holiday 2025 · images and videos · match threshold 85%")).toBeInTheDocument();
    });

    it("names images only", () => {
        running();
        useScanStore.setState({ heading: { count: 36, set: "36 files", kinds: "images", threshold: 90 } });
        render(<ScanScreen />);

        expect(screen.getByRole("heading", { level: 1, name: "Comparing 36 files" })).toBeInTheDocument();
        expect(screen.getByText(/· images · match threshold 90%$/)).toBeInTheDocument();
    });
});

describe("Scan progress", () => {
    it("shows the percentage, the time left, the bar and the files done partway, with one phase row", () => {
        running({ done: 30, etaSeconds: 24 });
        render(<ScanScreen />);

        const card = screen.getByRole("region", { name: "Comparison" });
        expect(card).toHaveTextContent("62%");
        expect(card).toHaveTextContent("About 24 s left");
        expect(screen.getByRole("progressbar", { name: "Comparison progress" })).toHaveAttribute("aria-valuenow", "62");
        expect(screen.getByText("30 / 48")).toHaveClass("text-primary");
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(card).not.toHaveTextContent("Scoring");
    });

    it("reads Done with a check once every file is grouped", () => {
        running({ done: 48, etaSeconds: 0 });
        render(<ScanScreen />);

        expect(screen.getByText("Done")).toHaveClass("text-muted-foreground");
        expect(screen.getByTestId("phase-done")).toBeInTheDocument();
        expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
    });

    it("starts at 0% with no estimate, and no file processing", () => {
        running();
        render(<ScanScreen />);

        const card = screen.getByRole("region", { name: "Comparison" });
        expect(card).toHaveTextContent("0%");
        expect(card).toHaveTextContent("Estimating time left");
        expect(card).toHaveTextContent("0 / 48");
        expect(card).not.toHaveTextContent("Now processing");
    });

    it("shows the phase with a spinning mark while the scan runs", () => {
        running();
        render(<ScanScreen />);

        expect(screen.getByText("Grouping similar files")).toBeInTheDocument();
        expect(screen.getByText("Matching media above the threshold")).toBeInTheDocument();
        expect(screen.getByTestId("spinner")).toBeInTheDocument();
    });

    it("stops the spinning mark once the scan is done", () => {
        running({ done: 48, etaSeconds: 0 });
        useScanStore.setState({ status: "done" });
        render(<ScanScreen />);

        expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
        expect(screen.getByText("Almost done")).toBeInTheDocument();
    });

    it("counts the files that couldn't be read in the hint", () => {
        running({ done: 3, skipped: 1 });
        const { rerender } = render(<ScanScreen />);

        expect(screen.getByText("Matching media above the threshold · 1 file couldn't be read")).toBeInTheDocument();

        act(() => useScanStore.setState({ progress: { done: 4, total: 48, skipped: 2 } }));
        rerender(<ScanScreen />);
        expect(screen.getByText("Matching media above the threshold · 2 files couldn't be read")).toBeInTheDocument();
    });
});

describe("Now processing", () => {
    it("shows the file's path as the set list writes it, beside its thumbnail", () => {
        running({ done: 1 });
        useScanStore.setState({
            current: {
                path: "/Users/ana/Pictures/Holiday 2025/IMG_3312.jpg",
                display: "~/Pictures/Holiday 2025/IMG_3312.jpg",
            },
        });
        render(<ScanScreen />);

        const card = screen.getByRole("region", { name: "Comparison" });
        expect(within(card).getByText("Now processing")).toBeInTheDocument();
        const path = within(card).getByText("~/Pictures/Holiday 2025/IMG_3312.jpg");
        expect(path).toHaveClass("truncate");
        expect(path).toHaveAttribute("title", "~/Pictures/Holiday 2025/IMG_3312.jpg");
        expect(card.querySelector("img")).toHaveAttribute("src", "thumb://localhost/id-IMG_3312.jpg?size=96");
    });

    it("falls back to the icon of the file's kind when the thumbnail can't be produced", () => {
        running({ done: 1 });
        useScanStore.setState({
            current: { path: "/Users/ana/Pictures/Holiday 2025/clip.mp4", display: "~/Pictures/Holiday 2025/clip.mp4" },
        });
        render(<ScanScreen />);
        const card = screen.getByRole("region", { name: "Comparison" });

        const image = card.querySelector("img");
        expect(image).not.toBeNull();
        if (image) fireEvent.error(image);

        expect(card.querySelector("img")).toHaveClass("invisible");
        expect(card.querySelector("svg.lucide-video")).not.toBeNull();
    });
});

describe("Scan finishes", () => {
    it("shows that the comparison couldn't finish, with Back to gallery", () => {
        running();
        useScanStore.setState({ status: "failed" });
        render(<ScanScreen />);

        expect(screen.getByRole("alert")).toHaveTextContent("The comparison couldn't finish.");
        expect(screen.getByRole("button", { name: "Back to gallery" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });
});

describe("Cancelling a scan", () => {
    const folder: SourceView = {
        path: "/Users/ana/Pictures/Holiday 2025",
        name: "Holiday 2025",
        location: "~/Pictures/Holiday 2025",
        kind: "folder",
        count: FILES.length,
        size: FILES.length,
        unreadable: false,
        pending: false,
    };

    beforeEach(() => {
        useHomeStore.setState({
            view: { revision: 1, sources: [folder], total: FILES.length },
            sources: [],
            rescans: 0,
        });
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useGalleryStore.setState({ listing: { status: "ready", revision: 1, files: FILES } });
    });

    /** The gallery's Compare button. */
    const compareButton = () => screen.getByRole("button", { name: /^Compare \d+ files?$/ });

    it.each(["Cancel", "Back to gallery"])(
        "%s returns to the gallery as it was, with focus on Compare",
        async (name) => {
            const clip = "/Users/ana/Pictures/Holiday 2025/clip.mp4";
            useGalleryStore.setState({ filter: "videos", threshold: 72, overrides: new Set([clip]) });
            useGalleryStore.getState().select(clip);
            const gallery = useGalleryStore.getState();
            render(<App />);
            act(() => useScreenStore.getState().show("gallery"));
            act(() => useScanStore.getState().start());
            if (name === "Back to gallery") act(() => useScanStore.setState({ status: "failed" }));

            fireEvent.click(screen.getByRole("button", { name }));

            expect(screen.getByRole("tab", { name: /^Videos/ })).toHaveAttribute("aria-selected", "true");
            expect(screen.getByText("72%")).toBeInTheDocument();
            expect(useGalleryStore.getState()).toBe(gallery);
            expect(useScanStore.getState().status).toBe("idle");
            await waitFor(() => expect(compareButton()).toHaveFocus());
        },
    );

    it("stops the scan", () => {
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));
        act(() => useScanStore.getState().start());

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(mockedCancel).toHaveBeenCalledOnce();
    });

    it("shows the note that files are only read", () => {
        running();
        render(<ScanScreen />);

        expect(
            screen.getByText("Files are only read. Nothing is changed until you review the results."),
        ).toBeInTheDocument();
    });
});
