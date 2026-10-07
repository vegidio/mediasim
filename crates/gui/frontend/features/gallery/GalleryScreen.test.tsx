import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { listSetMedia, type SetMedia, type SourceView } from "@/ipc/set";
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

/** The grid's height in a 720 px window, below the 56 px header and the 72 px toolbar. */
const GRID_HEIGHT = 720 - 56 - 72;

/** Lay every element out `width` px wide and as tall as the grid; jsdom lays nothing out itself. */
const layOut = (width: number) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(GRID_HEIGHT);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ width, height: GRID_HEIGHT }),
    );
};

/** Every `ResizeObserver` callback, so a test can report a resize. */
const observers: ResizeObserverCallback[] = [];

const resize = (width: number) => {
    layOut(width);
    act(() => {
        for (const callback of observers) callback([], {} as ResizeObserver);
    });
};

const files = (types: MediaType[]): MediaFile[] =>
    types.map((type, i) => {
        const name = `${type === "video" ? "VID" : "IMG"}_${String(i).padStart(5, "0")}.${type === "video" ? "mp4" : "jpg"}`;
        return { path: `/p/${name}`, name, type, size: 1000, identity: String(i).padStart(16, "0") };
    });

const images = (count: number) => files(Array(count).fill("image"));

const folder: SourceView = {
    path: "/p",
    name: "p",
    location: "/p",
    kind: "folder",
    count: 0,
    size: 0,
    unreadable: false,
    pending: false,
};

/** Put a folder of `total` files in the set, with `listing` as what reading it gives. */
const withSet = (total: number, listing: Promise<SetMedia> | SetMedia) => {
    const sources = [{ ...folder, count: total }];
    useStartStore.setState({ view: { revision: 1, sources, total }, sources, rescans: 0 });
    mockedList.mockImplementation(() => Promise.resolve(listing));
};

const grid = () => screen.getByTestId("gallery-grid");
/** The rows the grid renders, each holding its tiles. */
const rows = () => Array.from(grid().firstElementChild?.children ?? [], (row) => row.firstElementChild);
const tiles = () => screen.queryAllByRole("button", { name: /^Open / });

describe("GalleryScreen", () => {
    beforeEach(() => {
        localStorage.clear();
        observers.length = 0;
        vi.stubGlobal(
            "ResizeObserver",
            class {
                constructor(callback: ResizeObserverCallback) {
                    observers.push(callback);
                }
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        );
        layOut(1280);
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useStartStore.setState(useStartStore.getInitialState(), true);
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("fits 7 columns at 1280 px and 8 once resized to 1440 px", async () => {
        withSet(20, { revision: 1, files: images(20) });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles()).toHaveLength(20));

        expect(rows()[0]?.children).toHaveLength(7);

        resize(1440);

        expect(rows()[0]?.children).toHaveLength(8);
        expect(rows()[2]?.children).toHaveLength(4);
    });

    it("renders only the rows in view for 10,000 files", async () => {
        withSet(10_000, { revision: 1, files: images(10_000) });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles().length).toBeGreaterThan(0));

        // Four rows fit in view, and two more are kept below.
        expect(rows().length).toBeLessThanOrEqual(7);
        expect(tiles().length).toBeLessThanOrEqual(7 * 7);
        expect(grid().firstElementChild).toHaveStyle({ height: `${Math.ceil(10_000 / 7) * 164 + 24 + 4}px` });
    });

    it("shows the tiles in the order they were read", async () => {
        const read = files(["image", "video", "image"]);
        withSet(3, { revision: 1, files: read });
        render(<GalleryScreen />);

        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual(read.map((file) => `Open ${file.name}`));
    });

    it("shows a placeholder per counted file while reading, then the tiles", async () => {
        let resolve: (media: SetMedia) => void = () => {};
        withSet(
            10,
            new Promise((r) => {
                resolve = r;
            }),
        );
        render(<GalleryScreen />);

        expect(screen.getAllByTestId("placeholder-tile")).toHaveLength(10);
        expect(tiles()).toHaveLength(0);

        await act(async () => resolve({ revision: 1, files: images(10) }));

        expect(screen.queryAllByTestId("placeholder-tile")).toHaveLength(0);
        expect(tiles()).toHaveLength(10);
    });

    it("reports a failed read, and reads again on Try again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        withSet(2, { revision: 1, files: images(2) });
        mockedList.mockRejectedValueOnce(new Error("boom"));
        render(<GalleryScreen />);

        expect(await screen.findByText("Couldn't read the files in this set.")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        await waitFor(() => expect(tiles()).toHaveLength(2));
        expect(rows()[0]?.children).toHaveLength(2);
    });

    it("dims the image tiles in place under Videos", async () => {
        const read = files(["image", "video", "image", "video"]);
        withSet(4, { revision: 1, files: read });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles()).toHaveLength(4));

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));

        expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual(read.map((file) => `Open ${file.name}`));
        for (const [i, tile] of tiles().entries()) {
            const leftOut = read[i]?.type === "image";
            expect(tile.hasAttribute("title")).toBe(leftOut);
            expect(tile.classList.contains("grayscale")).toBe(leftOut);
        }
        expect(screen.getByRole("tabpanel")).toContainElement(grid());
    });

    it("keeps the filter across Back and Continue, and starts the threshold from the setting again", async () => {
        withSet(4, { revision: 1, files: files(["image", "video", "image", "video"]) });
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));
        await waitFor(() => expect(tiles()).toHaveLength(4));
        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));
        const slider = screen.getByRole("slider", { name: "Match threshold" });
        for (let i = 0; i < 8; i++) fireEvent.keyDown(slider, { key: "ArrowLeft" });

        fireEvent.click(screen.getByRole("button", { name: "Back" }));
        fireEvent.click(screen.getByRole("button", { name: "Continue with 4 files" }));

        expect(screen.getByRole("tab", { name: /^Videos/ })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("slider", { name: "Match threshold" })).toHaveAttribute("aria-valuenow", "80");
        expect(within(screen.getByRole("main")).getByText("80%")).toBeInTheDocument();
        expect(mockedList).toHaveBeenCalledOnce();
    });
});
