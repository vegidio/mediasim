import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { listSetMedia, type SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { useStartStore } from "@/stores/start";
import { GalleryScreen } from "./GalleryScreen";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn(() => new Promise(() => {})) }));

const mockedList = listSetMedia as Mock;

const source = (overrides: Partial<SourceView>): SourceView => ({
    path: "/p",
    name: "p",
    location: "~",
    kind: "folder",
    count: 0,
    size: 0,
    unreadable: false,
    pending: false,
    ...overrides,
});

const media = (images: number, videos: number, size = 1): MediaFile[] =>
    [...Array(images).fill("image"), ...Array(videos).fill("video")].map((type: MediaType, i) => ({
        path: `/p/${String(i).padStart(3, "0")}`,
        name: `${i}`,
        type,
        size,
        identity: String(i).padStart(16, "0"),
    }));

/** Put `sources` in the set, with `files` as what listing it reads. */
const withSet = (sources: SourceView[], files: MediaFile[]) => {
    useStartStore.setState({ view: { revision: 1, sources, total: files.length }, sources, rescans: 0 });
    mockedList.mockResolvedValue({ revision: 1, files });
};

const holiday = source({ path: "/Pictures/Holiday 2025", name: "Holiday 2025", location: "~/Pictures/Holiday 2025" });

/** Render the gallery and wait until its files have been read. */
const renderGallery = async () => {
    render(<GalleryScreen />);
    await waitFor(() => expect(useGalleryStore.getState().listing.status).toBe("ready"));
};

const compare = () => screen.getByRole("button", { name: /^Compare/ });

describe("GalleryToolbar", () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useStartStore.setState(useStartStore.getInitialState(), true);
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("goes Back to the start screen with the set unchanged, and focus on Continue", async () => {
        withSet([holiday], media(48, 0));
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));

        fireEvent.click(screen.getByRole("button", { name: "Back" }));

        expect(useScreenStore.getState().screen).toBe("start");
        expect(screen.getByRole("list", { name: "Selected sources" })).toHaveTextContent("Holiday 2025");
        const continueButton = screen.getByRole("button", { name: "Continue with 48 files" });
        await waitFor(() => expect(continueButton).toHaveFocus());
    });

    it("shows one folder by its name, path and size", async () => {
        withSet([holiday], media(2, 0, 600_000_000));

        await renderGallery();

        expect(screen.getByText("Holiday 2025")).toBeInTheDocument();
        expect(screen.getByText("~/Pictures/Holiday 2025 · 1.2 GB")).toBeInTheDocument();
    });

    it("shows several sources by their file count and locations", async () => {
        withSet(
            [
                source({ location: "~/Pictures/A" }),
                source({ location: "~/Pictures/B" }),
                source({ kind: "image", location: "~/Downloads" }),
            ],
            media(18, 0, 0),
        );

        await renderGallery();

        expect(screen.getByText("18 files")).toBeInTheDocument();
        expect(screen.getByText("From 3 locations · 0 B")).toBeInTheDocument();
    });

    it("shows each tab's count, with Both selected", async () => {
        withSet([holiday], media(36, 12));

        await renderGallery();

        expect(screen.getByRole("tab", { name: "Images 36" })).toHaveAttribute("aria-selected", "false");
        expect(screen.getByRole("tab", { name: "Videos 12" })).toHaveAttribute("aria-selected", "false");
        expect(screen.getByRole("tab", { name: "Both 48" })).toHaveAttribute("aria-selected", "true");
    });

    it("hides the counts and disables Compare while the files are read", () => {
        withSet([holiday], []);
        mockedList.mockReturnValue(new Promise(() => {}));

        render(<GalleryScreen />);

        expect(screen.getByRole("tab", { name: "Both" })).toBeInTheDocument();
        expect(compare()).toHaveAccessibleName("Compare");
        expect(compare()).toBeDisabled();
        expect(screen.getByText("~/Pictures/Holiday 2025")).toBeInTheDocument();
    });

    it("moves between tabs with the arrow keys, changing the filter", async () => {
        withSet([holiday], media(36, 12));
        await renderGallery();
        const both = screen.getByRole("tab", { name: /^Both/ });
        both.focus();

        fireEvent.keyDown(both, { key: "ArrowLeft" });

        const videos = screen.getByRole("tab", { name: /^Videos/ });
        await waitFor(() => expect(videos).toHaveFocus());
        expect(videos).toHaveAttribute("aria-selected", "true");
        expect(useGalleryStore.getState().filter).toBe("videos");
        expect(compare()).toHaveAccessibleName("Compare 12 files");
    });

    it("moves the threshold with the arrow keys without changing the setting", async () => {
        useSettingsStore.getState().update({ matchThreshold: 90 });
        withSet([holiday], media(2, 0));
        await renderGallery();
        const slider = screen.getByRole("slider", { name: "Match threshold" });
        expect(screen.getByText("90%")).toBeInTheDocument();

        fireEvent.keyDown(slider, { key: "ArrowLeft" });
        fireEvent.keyDown(slider, { key: "ArrowLeft" });

        expect(slider).toHaveAttribute("aria-valuenow", "88");
        expect(screen.getByText("88%")).toBeInTheDocument();
        expect(useSettingsStore.getState().matchThreshold).toBe(90);
    });

    it("reads Compare 1 file and is disabled below two files", async () => {
        withSet([holiday], media(3, 1));
        await renderGallery();
        expect(compare()).toHaveAccessibleName("Compare 4 files");
        expect(compare()).toBeEnabled();

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));

        expect(compare()).toHaveAccessibleName("Compare 1 file");
        expect(compare()).toBeDisabled();
    });

    it("names every control", async () => {
        withSet([holiday], media(36, 12));

        await renderGallery();

        expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
        expect(screen.getByRole("tablist", { name: "Filter media" })).toBeInTheDocument();
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Images 36", "Videos 12", "Both 48"]);
        expect(screen.getByRole("slider", { name: "Match threshold" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Compare 48 files" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Comparison options" })).toBeInTheDocument();
    });
});
