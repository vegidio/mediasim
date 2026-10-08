import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import App from "@/App";
import { listSetMedia, rescanSet, type SourceView } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";

vi.mock("@/ipc/os", () => ({ isMacOs: vi.fn(() => false) }));
vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));
vi.mock("@/ipc/formats", () => ({ supportedFormats: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/ipc/set", () => ({ addToSet: vi.fn(), removeFromSet: vi.fn(), rescanSet: vi.fn(), listSetMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn(() => new Promise(() => {})) }));

const holiday: SourceView = {
    path: "/Pictures/Holiday 2025",
    name: "Holiday 2025",
    location: "~/Pictures/Holiday 2025",
    kind: "folder",
    count: 0,
    size: 0,
    unreadable: false,
    pending: false,
};

const media = (images: number, videos: number): MediaFile[] =>
    [...Array(images).fill("image"), ...Array(videos).fill("video")].map((type, i) => ({
        path: `/p/${String(i).padStart(3, "0")}`,
        name: `${i}`,
        type,
        size: 1,
        identity: String(i).padStart(16, "0"),
    }));

/** Put the holiday folder in the set, holding `files`. */
const withSet = (files: MediaFile[]) => {
    const view = { revision: 1, sources: [holiday], total: files.length };
    useHomeStore.setState({ view, sources: [holiday], rescans: 0 });
    (rescanSet as Mock).mockResolvedValue(view);
    (listSetMedia as Mock).mockResolvedValue({ revision: 1, files });
};

/** Render the app on the Home screen, then Continue into the gallery and wait until its files have been read. */
const continueToGallery = async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Continue with/ }));
    await waitFor(() => expect(useGalleryStore.getState().listing.status).toBe("ready"));
};

const renderGallery = async (files = media(3, 1)) => {
    withSet(files);
    render(<App />);
    await continueToGallery();
};

// While the menu is open it is modal, and the rest of the page is hidden from assistive technology.
const chevron = () => screen.getByRole("button", { name: "Comparison options", hidden: true });
const grid = () => screen.getByRole("grid", { name: "Files", hidden: true });
const menu = () => screen.getByRole("menu", { name: "Comparison options" });
const option = (name: string) => within(menu()).getByRole("menuitemcheckbox", { name });

/** Open the menu from the chevron, as a primary-button press does. */
const openMenu = async () => {
    fireEvent.pointerDown(chevron(), { button: 0, ctrlKey: false });
    return screen.findByRole("menu", { name: "Comparison options" });
};

const ticked = () => ({
    rotate: option("Frame rotate").getAttribute("aria-checked"),
    flip: option("Frame flip").getAttribute("aria-checked"),
});

const goBack = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));

describe("ComparisonOptionsMenu", () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useHomeStore.setState(useHomeStore.getInitialState(), true);
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("opens below the chevron with the heading, both options and the Settings link", async () => {
        await renderGallery();
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();

        const opened = await openMenu();

        expect(chevron()).toHaveAttribute("aria-expanded", "true");
        expect(chevron()).toHaveAttribute("data-state", "open");
        expect(within(opened).getByText("Also compare each frame")).toBeInTheDocument();
        expect(within(opened).getAllByRole("menuitemcheckbox")).toEqual([option("Frame rotate"), option("Frame flip")]);
        expect(option("Frame rotate")).toHaveAccessibleDescription(
            "Also compare each frame rotated 90°, 180° and 270°",
        );
        expect(option("Frame flip")).toHaveAccessibleDescription(
            "Also compare each frame flipped vertically and horizontally",
        );
        expect(opened).toHaveTextContent(
            "Finds copies that were rotated or mirrored. Each option adds comparisons, so scans take longer. The defaults can be changed in Settings.",
        );
        expect(within(opened).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    });

    it("closes when the chevron is pressed again", async () => {
        await renderGallery();
        await openMenu();

        fireEvent.pointerDown(chevron(), { button: 0, ctrlKey: false });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(chevron()).toHaveAttribute("aria-expanded", "false");
    });

    it("starts each option from its setting", async () => {
        useSettingsStore.getState().update({ frameRotate: true, frameFlip: false });
        await renderGallery();

        await openMenu();

        expect(ticked()).toEqual({ rotate: "true", flip: "false" });
    });

    it("flips an option by pointer, Enter or Space, keeping the menu open", async () => {
        await renderGallery();
        await openMenu();

        fireEvent.click(option("Frame flip"));
        expect(option("Frame flip")).toHaveAttribute("aria-checked", "false");
        expect(menu()).toBeInTheDocument();

        option("Frame rotate").focus();
        fireEvent.keyDown(option("Frame rotate"), { key: " " });
        expect(option("Frame rotate")).toHaveAttribute("aria-checked", "false");
        expect(menu()).toBeInTheDocument();

        option("Frame flip").focus();
        fireEvent.keyDown(option("Frame flip"), { key: "Enter" });
        expect(option("Frame flip")).toHaveAttribute("aria-checked", "true");
        expect(menu()).toBeInTheDocument();
    });

    it("leaves the Settings switch on when an option is unticked", async () => {
        await renderGallery();
        await openMenu();
        fireEvent.click(option("Frame rotate"));

        fireEvent.click(within(menu()).getByRole("menuitem", { name: "Settings" }));

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(screen.getByRole("switch", { name: "Frame rotate" })).toBeChecked();
    });

    it("starts a new comparison from the settings again after Back and Continue", async () => {
        await renderGallery();
        await openMenu();
        fireEvent.click(option("Frame rotate"));
        fireEvent.keyDown(menu(), { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

        goBack();
        await continueToGallery();
        await openMenu();

        expect(ticked()).toEqual({ rotate: "true", flip: "true" });
    });

    it("moves only the option whose setting changed in Settings", async () => {
        await renderGallery();
        await openMenu();
        fireEvent.click(option("Frame rotate"));
        fireEvent.click(option("Frame flip"));
        fireEvent.click(within(menu()).getByRole("menuitem", { name: "Settings" }));
        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

        const flipSetting = screen.getByRole("switch", { name: "Frame flip" });
        fireEvent.click(flipSetting);
        fireEvent.click(flipSetting);
        goBack();
        await openMenu();

        expect(ticked()).toEqual({ rotate: "false", flip: "true" });
    });

    it("keeps unticked options when Reset to defaults changes neither setting", async () => {
        await renderGallery();
        await openMenu();
        fireEvent.click(option("Frame rotate"));
        fireEvent.click(option("Frame flip"));

        act(() => useSettingsStore.getState().reset());

        expect(ticked()).toEqual({ rotate: "false", flip: "false" });
    });

    it("opens Settings from its link, and going back shows the gallery with the options kept", async () => {
        await renderGallery();
        await openMenu();
        fireEvent.click(option("Frame flip"));

        fireEvent.click(within(menu()).getByRole("menuitem", { name: "Settings" }));

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "Frame flip" })).toBeChecked();

        goBack();

        expect(useScreenStore.getState().screen).toBe("gallery");
        await openMenu();
        expect(ticked()).toEqual({ rotate: "true", flip: "false" });
    });

    it("closes on Escape and hands focus back to the grid, whose arrow keys move the selection again", async () => {
        await renderGallery();
        // As a click on the first tile does.
        act(() => useGalleryStore.getState().select("/p/000"));
        grid().focus();
        await openMenu();

        fireEvent.keyDown(menu(), { key: "Escape" });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        await waitFor(() => expect(grid()).toHaveFocus());
        fireEvent.keyDown(grid(), { key: "ArrowRight" });
        expect(useGalleryStore.getState().selected).toBe("/p/001");
    });

    it("closes on a click outside and hands focus back to the grid, keeping the selection", async () => {
        await renderGallery();
        act(() => useGalleryStore.getState().select("/p/002"));
        await openMenu();

        // Radix dismisses on `pointerdown` outside the content.
        fireEvent.pointerDown(document.body);

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        await waitFor(() => expect(grid()).toHaveFocus());
        expect(useGalleryStore.getState().selected).toBe("/p/002");
    });

    it("returns focus to the chevron when it was opened from the keyboard", async () => {
        await renderGallery();
        chevron().focus();
        fireEvent.keyDown(chevron(), { key: "Enter" });
        await screen.findByRole("menu", { name: "Comparison options" });

        fireEvent.keyDown(menu(), { key: "Escape" });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(chevron()).toHaveFocus();
    });

    it("returns focus to the chevron when a menu opened from the keyboard is closed by the chevron", async () => {
        await renderGallery();
        chevron().focus();
        fireEvent.keyDown(chevron(), { key: "Enter" });
        await screen.findByRole("menu", { name: "Comparison options" });

        fireEvent.pointerDown(chevron(), { button: 0, ctrlKey: false });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(chevron()).toHaveFocus();
    });

    it("moves between the options and the link with the arrow keys", async () => {
        await renderGallery();
        const opened = await openMenu();
        const items = [option("Frame rotate"), option("Frame flip"), within(opened).getByRole("menuitem")];
        items[0]?.focus();

        // Radix moves roving focus on the next task.
        for (const next of items.slice(1)) {
            fireEvent.keyDown(document.activeElement ?? opened, { key: "ArrowDown" });
            await waitFor(() => expect(next).toHaveFocus());
        }
    });

    it("keeps the chevron enabled while Compare is disabled", async () => {
        await renderGallery(media(1, 0));
        expect(screen.getByRole("button", { name: "Compare 1 file" })).toBeDisabled();
        expect(chevron()).toBeEnabled();

        expect(await openMenu()).toBeInTheDocument();
    });
});
