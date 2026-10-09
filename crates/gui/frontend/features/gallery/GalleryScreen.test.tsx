import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import type { MediaType } from "@/ipc/formats";
import { listSetMedia, rescanSet, type SetMedia, type SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { GalleryScreen } from "./GalleryScreen";

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
vi.mock("@/ipc/pair", () => ({
    probeMedia: vi.fn(async (path: string) => ({ path, type: "image", width: 4, height: 3, size: 1000 })),
}));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/ipc/open", () => ({ openMedia: vi.fn(), revealMedia: vi.fn() }));

const mockedList = listSetMedia as Mock;
const mockedRescan = rescanSet as Mock;

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

/** Files named `names`, in that order, with `.mov` ones videos and the rest images. */
const named = (names: string[]): MediaFile[] =>
    names.map((name, i) => ({
        path: `/p/${name}`,
        name,
        type: name.endsWith(".mov") ? "video" : "image",
        size: 1000,
        identity: String(i).padStart(16, "0"),
    }));

/** The display order of the scenarios: images and videos taking turns. */
const MIXED = ["a.jpg", "b.mov", "c.jpg", "d.mov", "e.jpg"];

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
    useHomeStore.setState({ view: { revision: 1, sources, total }, sources, rescans: 0 });
    mockedList.mockImplementation(() => Promise.resolve(listing));
};

const grid = () => screen.getByTestId("gallery-grid");
/** The rows the grid renders. */
const rows = () => within(grid()).queryAllByRole("row");
/** The cells the grid's `index`th rendered row owns: its tiles, which sit beside it in one layer. */
const rowCells = (index: number) =>
    (rows()[index]?.getAttribute("aria-owns")?.split(" ") ?? []).map((id) => document.getElementById(id));
const tiles = () => screen.queryAllByRole("button", { name: /^Open / });
/** The tile, the grid's cell, of the file named `name`. */
const cell = (name: string) =>
    screen.getByRole("button", { name: `Open ${name}` }).closest('[role="gridcell"]') as HTMLElement;
/** Whether `tile`'s picture and text are dimmed and in grayscale. */
const isDimmed = (tile: HTMLElement) => tile.querySelector(".grayscale") !== null;
/** The path of the selected tile's file, as the store holds it. */
const selected = () => useGalleryStore.getState().selected;
/** The names of the tiles the grid shows as selected. */
const shownSelected = () =>
    screen
        .queryAllByRole("gridcell", { selected: true })
        .map((tile) => tile.querySelector("button")?.getAttribute("aria-label"));
/** The names of the files the grid shows, in its order. */
const shownNames = () => tiles().map((tile) => tile.getAttribute("aria-label")?.replace(/^Open /, ""));
/** Press `key` on the grid; whether the grid let the browser act on it. */
const press = (key: string) => fireEvent.keyDown(grid(), { key });
const compare = () => screen.getByRole("button", { name: /^Compare/ });

/** Make the grid scroll as a browser would; jsdom has no `scrollTo` and no scroll height. */
const scrollable = (count: number) => {
    Object.defineProperty(grid(), "scrollHeight", { get: () => Math.ceil(count / 7) * 164 + 28 });
    Object.defineProperty(grid(), "scrollTo", {
        value: ({ top = 0 }: ScrollToOptions) => {
            grid().scrollTop = top;
            fireEvent.scroll(grid());
        },
    });
};

/** Render the gallery on `read`, waiting for its tiles. */
const showGallery = async (read: MediaFile[]) => {
    withSet(read.length, { revision: 1, files: read });
    render(<GalleryScreen />);
    await waitFor(() => expect(tiles().length).toBeGreaterThan(0));
};

describe("GalleryScreen", () => {
    beforeEach(() => {
        localStorage.clear();
        observers.length = 0;
        // A recount that finds the set as it was.
        mockedRescan.mockReset().mockImplementation(async () => useHomeStore.getState().view);
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
        useHomeStore.setState(useHomeStore.getInitialState(), true);
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("fits 7 columns at 1280 px and 8 once resized to 1440 px", async () => {
        withSet(20, { revision: 1, files: images(20) });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles()).toHaveLength(20));

        expect(rowCells(0)).toHaveLength(7);

        resize(1440);

        expect(rowCells(0)).toHaveLength(8);
        expect(rowCells(2)).toHaveLength(4);
    });

    it("owns each row's tiles, in the grid's order", async () => {
        await showGallery(images(10));

        expect(rowCells(1).map((tile) => tile?.querySelector("button")?.getAttribute("aria-label"))).toEqual(
            ["IMG_00007.jpg", "IMG_00008.jpg", "IMG_00009.jpg"].map((name) => `Open ${name}`),
        );
        expect(rows()[1]).toHaveAttribute("aria-rowindex", "2");
    });

    it("keeps a tile's element when the tab moves it to another row", async () => {
        // At 7 columns, the image after the videos is on the second row until "Images" puts it first.
        await showGallery(files([...Array(9).fill("video"), "image"]));
        const tile = cell("IMG_00009.jpg");
        expect(rowCells(1)).toContain(tile);

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Images/ }));

        expect(cell("IMG_00009.jpg")).toBe(tile);
        expect(rowCells(0)[0]).toBe(tile);
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
        expect(rowCells(0)).toHaveLength(2);
    });

    it("puts the video tiles first under Videos, with the image tiles dimmed after them", async () => {
        const read = files(["image", "video", "image", "video"]);
        withSet(4, { revision: 1, files: read });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles()).toHaveLength(4));

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));

        expect(shownNames()).toEqual(["VID_00001.mp4", "VID_00003.mp4", "IMG_00000.jpg", "IMG_00002.jpg"]);
        for (const [i, open] of tiles().entries()) {
            const leftOut = i >= 2;
            // The Open button sits in the picture, inside the tile that carries the tooltip and dimming.
            const tile = open.closest(".group") as HTMLElement;
            expect(tile.hasAttribute("title")).toBe(leftOut);
            expect(isDimmed(tile)).toBe(leftOut);
        }
        expect(screen.getByRole("tabpanel")).toContainElement(grid());
    });

    it("keeps each run in display order under a tab, and goes back to display order under Both", async () => {
        await showGallery(named(MIXED));

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));
        expect(shownNames()).toEqual(["b.mov", "d.mov", "a.jpg", "c.jpg", "e.jpg"]);

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Images/ }));
        expect(shownNames()).toEqual(["a.jpg", "c.jpg", "e.jpg", "b.mov", "d.mov"]);

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Both/ }));
        expect(shownNames()).toEqual(MIXED);
    });

    it("steps through the details in the order the selected tab shows", async () => {
        await showGallery(named(["a.jpg", "b.mov", "c.jpg"]));
        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Images/ }));

        fireEvent.click(screen.getByRole("button", { name: "Open c.jpg" }));
        expect(within(screen.getByRole("dialog")).getByText("2 of 3")).toBeInTheDocument();
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next file" }));

        expect(screen.getByRole("dialog", { name: "Media details: b.mov" })).toBeInTheDocument();
        expect(within(screen.getByRole("dialog")).getByText("3 of 3")).toBeInTheDocument();
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
        await waitFor(() => expect(tiles()).toHaveLength(4));
    });

    it("drops a file deleted on disk when the gallery is opened again", async () => {
        withSet(2, { revision: 1, files: files(["image", "image"]) });
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));
        await waitFor(() => expect(tiles()).toHaveLength(2));
        fireEvent.click(screen.getByRole("button", { name: "Back" }));

        // The set is unchanged; only the recount Continue starts finds that the second file is gone.
        const [kept] = files(["image"]);
        mockedRescan.mockResolvedValueOnce({ revision: 2, sources: [{ ...folder, count: 1 }], total: 1 });
        mockedList.mockImplementation(() => Promise.resolve({ revision: 2, files: [kept] }));
        fireEvent.click(screen.getByRole("button", { name: "Continue with 2 files" }));

        await waitFor(() => expect(tiles()).toHaveLength(1));
        expect(mockedRescan).toHaveBeenCalledOnce();
    });

    it("shows a file removed in the details as removed in place, and leaves it out of Compare", async () => {
        const read = images(4);
        withSet(4, { revision: 1, files: read });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles()).toHaveLength(4));

        fireEvent.click(screen.getByRole("button", { name: "Open IMG_00001.jpg" }));
        fireEvent.click(screen.getByRole("button", { name: "Remove from comparison" }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual(read.map((file) => `Open ${file.name}`));
        const tile = screen.getByRole("button", { name: "Open IMG_00001.jpg" }).closest(".group") as HTMLElement;
        expect(tile).toHaveAttribute("title", "Removed from this comparison");
        expect(isDimmed(tile)).toBe(true);
        expect(within(tile).queryByText("Removed")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Compare/ })).toHaveAccessibleName("Compare 3 files");
    });

    it("shows a file added in the details as included in place, until the tab changes", async () => {
        const read = files(["image", "video", "image", "video"]);
        withSet(4, { revision: 1, files: read });
        render(<GalleryScreen />);
        await waitFor(() => expect(tiles()).toHaveLength(4));
        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Images/ }));

        fireEvent.click(screen.getByRole("button", { name: "Open IMG_00000.jpg" }));
        fireEvent.click(screen.getByRole("button", { name: "Remove from comparison" }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        fireEvent.click(screen.getByRole("button", { name: "Open VID_00001.mp4" }));
        fireEvent.click(screen.getByRole("button", { name: "Add to comparison" }));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        const tile = (name: string) =>
            screen.getByRole("button", { name: `Open ${name}` }).closest(".group") as HTMLElement;
        // Neither file moved: the images first, then the videos, as when the tab was selected.
        expect(shownNames()).toEqual(["IMG_00000.jpg", "IMG_00002.jpg", "VID_00001.mp4", "VID_00003.mp4"]);
        expect(tile("VID_00001.mp4")).not.toHaveAttribute("title");
        expect(isDimmed(tile("VID_00001.mp4"))).toBe(false);
        expect(tile("VID_00003.mp4")).toHaveAttribute("title", "Not included in this comparison");
        expect(tile("IMG_00000.jpg")).toHaveAttribute("title", "Removed from this comparison");
        expect(screen.getByRole("button", { name: /^Compare/ })).toHaveAccessibleName("Compare 2 files");

        fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));

        for (const name of ["VID_00001.mp4", "VID_00003.mp4"]) expect(tile(name)).not.toHaveAttribute("title");
        for (const name of ["IMG_00000.jpg", "IMG_00002.jpg"])
            expect(tile(name)).toHaveAttribute("title", "Not included in this comparison");
        expect(screen.getByRole("button", { name: /^Compare/ })).toHaveAccessibleName("Compare 2 files");
    });

    it("keeps removals across Back, and drops them when a new comparison starts", async () => {
        withSet(3, { revision: 1, files: images(3) });
        render(<App />);
        act(() => useScreenStore.getState().show("gallery"));
        await waitFor(() => expect(tiles()).toHaveLength(3));
        act(() => useGalleryStore.getState().toggle("/p/IMG_00000.jpg"));
        expect(screen.getByRole("button", { name: /^Compare/ })).toHaveAccessibleName("Compare 2 files");

        fireEvent.click(screen.getByRole("button", { name: "Back" }));
        expect(useGalleryStore.getState().overrides).toEqual(new Set(["/p/IMG_00000.jpg"]));

        fireEvent.click(screen.getByRole("button", { name: "Continue with 3 files" }));

        await waitFor(() => expect(tiles()).toHaveLength(3));
        expect(screen.getByRole("button", { name: /^Compare/ })).toHaveAccessibleName("Compare 3 files");
        const tile = screen.getByRole("button", { name: "Open IMG_00000.jpg" }).closest(".group") as HTMLElement;
        expect(isDimmed(tile)).toBe(false);
    });

    describe("selection", () => {
        it("selects a tile on a click, moving the selection on another, with the grid focused", async () => {
            await showGallery(images(10));

            fireEvent.click(screen.getByText("IMG_00003.jpg"));

            expect(shownSelected()).toEqual(["Open IMG_00003.jpg"]);
            expect(grid()).toHaveFocus();
            expect(grid()).toHaveAttribute("aria-activedescendant", cell("IMG_00003.jpg").id);

            fireEvent.click(cell("IMG_00004.jpg"));

            expect(shownSelected()).toEqual(["Open IMG_00004.jpg"]);
            expect(cell("IMG_00003.jpg")).toHaveAttribute("aria-selected", "false");
        });

        it("selects the tile and opens the details on a click on its Open chip", async () => {
            await showGallery(images(10));

            fireEvent.click(screen.getByRole("button", { name: "Open IMG_00002.jpg" }));

            expect(selected()).toBe("/p/IMG_00002.jpg");
            expect(screen.getByRole("dialog", { name: "Media details: IMG_00002.jpg" })).toBeInTheDocument();
        });

        it("clears the selection on a click on the grid's empty space", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00003.jpg"));

            // The second row, beside its three tiles.
            fireEvent.click(rows()[1] as HTMLElement);

            expect(shownSelected()).toEqual([]);
            expect(grid()).not.toHaveAttribute("aria-activedescendant");
        });

        it("keeps the selection on a dimmed tile across a tab change, with its ring outside the dimming", async () => {
            await showGallery(files(["image", "video", "image"]));
            fireEvent.click(cell("VID_00001.mp4"));

            fireEvent.mouseDown(screen.getByRole("tab", { name: /^Images/ }));

            const tile = cell("VID_00001.mp4");
            expect(shownSelected()).toEqual(["Open VID_00001.mp4"]);
            expect(isDimmed(tile)).toBe(true);
            expect(tile.querySelector(".ring-2")).not.toHaveClass("grayscale");
        });

        it("starts a new comparison with no tile selected", async () => {
            withSet(3, { revision: 1, files: images(3) });
            render(<App />);
            act(() => useScreenStore.getState().show("gallery"));
            await waitFor(() => expect(tiles()).toHaveLength(3));
            fireEvent.click(cell("IMG_00001.jpg"));

            fireEvent.click(screen.getByRole("button", { name: "Back" }));
            fireEvent.click(screen.getByRole("button", { name: "Continue with 3 files" }));

            await waitFor(() => expect(tiles()).toHaveLength(3));
            expect(shownSelected()).toEqual([]);
        });
    });

    describe("keyboard", () => {
        it("is a single tab stop, with the Open chips out of the tab order", async () => {
            await showGallery(images(48));

            expect(grid()).toHaveAttribute("tabindex", "0");
            expect(tiles().length).toBeGreaterThan(0);
            for (const open of tiles()) expect(open).toHaveAttribute("tabindex", "-1");
            expect(grid().querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0);
        });

        it("selects the first tile when tabbed into with none selected", async () => {
            await showGallery(images(10));

            act(() => grid().focus());

            expect(shownSelected()).toEqual(["Open IMG_00000.jpg"]);
        });

        it("keeps the selection when tabbed into with one selected", async () => {
            await showGallery(images(10));
            act(() => useGalleryStore.getState().select("/p/IMG_00005.jpg"));

            act(() => grid().focus());

            expect(shownSelected()).toEqual(["Open IMG_00005.jpg"]);
        });

        it("moves right across a row's end, and left back across its start", async () => {
            await showGallery(images(20));
            fireEvent.click(cell("IMG_00006.jpg"));

            expect(press("ArrowRight")).toBe(false);
            expect(shownSelected()).toEqual(["Open IMG_00007.jpg"]);

            press("ArrowLeft");
            expect(shownSelected()).toEqual(["Open IMG_00006.jpg"]);
        });

        it("selects a left-out tile with the arrow keys, with its ring outside the dimming", async () => {
            await showGallery(files(["video", "image", "video"]));
            fireEvent.mouseDown(screen.getByRole("tab", { name: /^Videos/ }));
            // The last video, after which come the left-out images.
            fireEvent.click(cell("VID_00002.mp4"));

            press("ArrowRight");

            const tile = cell("IMG_00001.jpg");
            expect(shownSelected()).toEqual(["Open IMG_00001.jpg"]);
            expect(isDimmed(tile)).toBe(true);
            expect(tile.querySelector(".ring-2")).not.toHaveClass("grayscale");
        });

        it("doesn't wrap at the gallery's ends", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00009.jpg"));

            press("ArrowRight");
            expect(shownSelected()).toEqual(["Open IMG_00009.jpg"]);
        });

        it("moves down into a shorter last row, to its last tile", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00005.jpg"));

            press("ArrowDown");

            expect(shownSelected()).toEqual(["Open IMG_00009.jpg"]);
        });

        it("selects the first tile on an arrow key with none selected", async () => {
            await showGallery(images(10));

            press("ArrowDown");

            expect(shownSelected()).toEqual(["Open IMG_00000.jpg"]);
        });

        it("follows the columns at the window's width", async () => {
            await showGallery(images(48));
            fireEvent.click(cell("IMG_00006.jpg"));

            resize(1440);
            press("ArrowDown");

            expect(shownSelected()).toEqual(["Open IMG_00014.jpg"]);
        });

        it("scrolls down to a row out of view", async () => {
            await showGallery(images(200));
            scrollable(200);
            // The fourth row is the last one in view.
            fireEvent.click(cell("IMG_00022.jpg"));
            expect(grid().scrollTop).toBe(0);

            press("ArrowDown");

            expect(shownSelected()).toEqual(["Open IMG_00029.jpg"]);
            expect(grid().scrollTop).toBeGreaterThan(0);
        });

        it("opens the details on Enter", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00004.jpg"));

            // Not left to the browser, which would press the dialog's newly focused Previous button with it.
            expect(press("Enter")).toBe(false);

            expect(screen.getByRole("dialog", { name: "Media details: IMG_00004.jpg" })).toBeInTheDocument();
        });

        it("removes the selected file on Space and adds it back, without scrolling", async () => {
            await showGallery(images(4));
            fireEvent.click(cell("IMG_00001.jpg"));
            expect(compare()).toHaveAccessibleName("Compare 4 files");

            expect(press(" ")).toBe(false);

            expect(cell("IMG_00001.jpg")).toHaveAttribute("title", "Removed from this comparison");
            expect(isDimmed(cell("IMG_00001.jpg"))).toBe(true);
            expect(compare()).toHaveAccessibleName("Compare 3 files");

            press(" ");

            expect(cell("IMG_00001.jpg")).not.toHaveAttribute("title");
            expect(isDimmed(cell("IMG_00001.jpg"))).toBe(false);
            expect(compare()).toHaveAccessibleName("Compare 4 files");
        });

        it("adds a left-out file on Space", async () => {
            await showGallery(files(["image", "video", "image", "video"]));
            fireEvent.mouseDown(screen.getByRole("tab", { name: /^Images/ }));
            fireEvent.click(cell("VID_00001.mp4"));
            expect(compare()).toHaveAccessibleName("Compare 2 files");

            press(" ");

            expect(cell("VID_00001.mp4")).not.toHaveAttribute("title");
            expect(compare()).toHaveAccessibleName("Compare 3 files");
        });

        it("clears the selection on Escape", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00004.jpg"));

            press("Escape");

            expect(shownSelected()).toEqual([]);
        });

        it("leaves the keys to the slider while it has focus", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00004.jpg"));
            const slider = screen.getByRole("slider", { name: "Match threshold" });
            slider.focus();

            fireEvent.keyDown(slider, { key: "ArrowRight" });

            expect(slider).toHaveAttribute("aria-valuenow", "81");
            expect(shownSelected()).toEqual(["Open IMG_00004.jpg"]);
        });
    });

    describe("a click on a filter tab", () => {
        /** Click the filter tab named `name` with the pointer, which presses it, then clicks it. */
        const clickTab = (name: RegExp) => {
            const tab = screen.getByRole("tab", { name });
            fireEvent.mouseDown(tab);
            tab.focus();
            fireEvent.click(tab, { detail: 1 });
        };

        it("hands focus back to the grid, where the arrow keys go on moving the selection", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00003.jpg"));

            clickTab(/^Images/);

            expect(screen.getByRole("tab", { name: /^Images/ })).toHaveAttribute("aria-selected", "true");
            expect(grid()).toHaveFocus();
            press("ArrowRight");
            expect(shownSelected()).toEqual(["Open IMG_00004.jpg"]);
        });

        it("keeps the selection on the same file, where the keys go on in the new tab's order", async () => {
            await showGallery(named(MIXED));
            fireEvent.click(cell("c.jpg"));

            clickTab(/^Images/);
            press("ArrowRight");

            expect(screen.getByRole("tab", { name: /^Images/ })).toHaveAttribute("aria-selected", "true");
            expect(shownSelected()).toEqual(["Open e.jpg"]);
        });

        it("scrolls the grid to its top on another tab, keeping the selection", async () => {
            await showGallery(files(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? "video" : "image"))));
            scrollable(200);
            fireEvent.click(cell("IMG_00001.jpg"));
            act(() => grid().scrollTo({ top: 1000 }));

            clickTab(/^Videos/);

            expect(grid().scrollTop).toBe(0);
            expect(selected()).toBe("/p/IMG_00001.jpg");
        });

        it("doesn't scroll the grid, move a tile or clear a removal on the selected tab", async () => {
            await showGallery(files(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? "video" : "image"))));
            scrollable(200);
            clickTab(/^Images/);
            act(() => grid().scrollTo({ top: 1000 }));
            const before = shownNames();
            const [removed] = before;
            act(() => useGalleryStore.getState().toggle(`/p/${removed}`));

            clickTab(/^Images/);

            expect(grid().scrollTop).toBe(1000);
            expect(shownNames()).toEqual(before);
            expect(cell(removed as string)).toHaveAttribute("title", "Removed from this comparison");
        });

        it("leaves the tiles selectable, by click and by the keys, while they slide", async () => {
            vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(GRID_HEIGHT);
            // Slides that never finish, so the clicks and keys below land partway through them.
            const animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: () => {} }));
            Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });

            try {
                await showGallery(named(MIXED));

                clickTab(/^Images/);
                expect(animate).toHaveBeenCalled();

                fireEvent.click(cell("b.mov"));
                expect(shownSelected()).toEqual(["Open b.mov"]);

                press("ArrowRight");
                expect(shownSelected()).toEqual(["Open d.mov"]);
            } finally {
                delete (Element.prototype as Partial<Element>).animate;
            }
        });

        it("selects no tile when none was selected", async () => {
            await showGallery(images(10));

            clickTab(/^Videos/);

            expect(grid()).toHaveFocus();
            expect(shownSelected()).toEqual([]);
        });

        it("leaves the arrow keys to the tabs when they are reached from the keyboard", async () => {
            await showGallery(images(10));
            fireEvent.click(cell("IMG_00003.jpg"));
            const tab = screen.getByRole("tab", { name: /^Both/ });
            tab.focus();

            // Enter and Space click a button with no pointer press.
            fireEvent.click(tab, { detail: 0 });

            expect(tab).toHaveFocus();
            expect(shownSelected()).toEqual(["Open IMG_00003.jpg"]);
        });
    });

    describe("closing the details", () => {
        it("selects the tile of the file last shown, scrolled into view, with the grid focused", async () => {
            await showGallery(images(200));
            scrollable(200);

            fireEvent.click(screen.getByRole("button", { name: "Open IMG_00003.jpg" }));
            expect(screen.getByRole("dialog", { name: "Media details: IMG_00003.jpg" })).toBeInTheDocument();
            act(() => useGalleryStore.getState().showDetails("/p/IMG_00150.jpg"));
            expect(screen.queryByRole("button", { name: "Open IMG_00150.jpg" })).not.toBeInTheDocument();

            fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

            await waitFor(() => expect(shownSelected()).toEqual(["Open IMG_00150.jpg"]));
            expect(grid()).toHaveFocus();
            expect(grid()).toHaveAttribute("aria-activedescendant", cell("IMG_00150.jpg").id);
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(useGalleryStore.getState().focusGrid).toBeUndefined();
        });

        it("lets the keys go on from the tile of the file last shown", async () => {
            await showGallery(images(20));
            fireEvent.click(cell("IMG_00003.jpg"));
            press("Enter");
            act(() => useGalleryStore.getState().showDetails("/p/IMG_00008.jpg"));

            fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
            await waitFor(() => expect(grid()).toHaveFocus());
            press("ArrowRight");

            expect(shownSelected()).toEqual(["Open IMG_00009.jpg"]);
        });
    });
});
