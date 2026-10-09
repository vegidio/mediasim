import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { GroupFile, ScanGroup } from "@/ipc/scan";
import { useScanStore } from "@/stores/scan";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { GroupsToolbar } from "./GroupsToolbar";

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
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));

const SUMMARY = "18 similar files in 7 groups · 48 scanned · threshold 85%";

// While the menu is open it is modal, and the rest of the page is hidden from assistive technology.
const chevron = () => screen.getByRole("button", { name: "More auto-select options", hidden: true });
const menu = () => screen.getByRole("menu", { name: "Auto-select options" });

/** Opens the menu from the chevron, as a primary-button press does. */
const openMenu = async () => {
    fireEvent.pointerDown(chevron(), { button: 0, ctrlKey: false });
    return screen.findByRole("menu", { name: "Auto-select options" });
};

/** The toolbar with the split button, and its marking handlers. */
const renderToolbar = (refocused = true) => {
    const marking = {
        onClear: vi.fn(),
        onAutoSelect: vi.fn(),
        onChooseRules: vi.fn(),
        refocus: vi.fn(() => refocused),
    };
    render(<GroupsToolbar summary={SUMMARY} marking={marking} />);
    return marking;
};

beforeEach(() => {
    useScreenStore.setState({ ...useScreenStore.getInitialState(), screen: "groups" }, true);
});

describe("AutoSelectMenu", () => {
    it("opens below the chevron with the item, its hint and the note, reporting the chevron expanded", async () => {
        renderToolbar();
        expect(chevron()).toHaveAttribute("aria-expanded", "false");

        const opened = await openMenu();

        expect(chevron()).toHaveAttribute("aria-expanded", "true");
        expect(chevron()).toHaveAttribute("data-state", "open");
        const item = within(opened).getByRole("menuitem", { name: "Choose rules…" });
        expect(item).toHaveAccessibleDescription("Review, reorder and save the rules before files are marked");
        expect(item.querySelector(".lucide-sliders-horizontal")).toHaveAttribute("aria-hidden", "true");
        expect(within(opened).getByRole("separator")).toBeInTheDocument();
        expect(opened).toHaveTextContent("Clicking Auto-select directly uses your default rules from Settings.");
        expect(within(opened).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    });

    it("calls onChooseRules once the menu has closed, after the item is chosen", async () => {
        const { onChooseRules, refocus } = renderToolbar();
        await openMenu();

        fireEvent.click(within(menu()).getByRole("menuitem", { name: "Choose rules…" }));

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(onChooseRules).toHaveBeenCalledOnce();
        expect(refocus).not.toHaveBeenCalled();
    });

    it("hands focus back to the selected tile when a menu opened by a click is closed with Escape", async () => {
        const { onChooseRules, refocus } = renderToolbar();
        await openMenu();

        fireEvent.keyDown(menu(), { key: "Escape" });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(refocus).toHaveBeenCalledOnce();
        expect(onChooseRules).not.toHaveBeenCalled();
    });

    it("returns focus to the chevron when no tile is selected", async () => {
        renderToolbar(false);
        await openMenu();

        fireEvent.keyDown(menu(), { key: "Escape" });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(chevron()).toHaveFocus();
    });

    it("returns focus to the chevron when it was opened from the keyboard", async () => {
        const { refocus } = renderToolbar();
        act(() => chevron().focus());
        fireEvent.keyDown(chevron(), { key: "Enter" });
        await screen.findByRole("menu", { name: "Auto-select options" });

        fireEvent.keyDown(menu(), { key: "Escape" });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(refocus).not.toHaveBeenCalled();
        expect(chevron()).toHaveFocus();
    });

    describe("the Settings link", () => {
        const file = (path: string): GroupFile => ({ path, type: "image", width: 1, height: 1, size: 1_000_000 });
        const group = (name: string): ScanGroup => ({
            files: [file(`/p/${name}/a.jpg`), file(`/p/${name}/b.jpg`), file(`/p/${name}/c.jpg`)],
            scores: [
                [1, 0.9, 0.9],
                [0.9, 1, 0.9],
                [0.9, 0.9, 1],
            ],
        });

        beforeEach(() => {
            useSettingsStore.setState(SETTINGS_DEFAULTS);
            useScanStore.setState(useScanStore.getInitialState(), true);
            useScanStore.setState({
                status: "done",
                heading: { count: 6, set: "Holiday 2025", kinds: "images", threshold: 85 },
                result: { groups: [group("a"), group("b")], skipped: [] },
                marks: new Set(["/p/a/b.jpg", "/p/a/c.jpg", "/p/b/c.jpg"]),
            });
        });

        it("opens Settings, and going back shows the same groups with the same marks", async () => {
            render(<App />);
            await openMenu();

            fireEvent.click(within(menu()).getByRole("menuitem", { name: "Settings" }));

            await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
            expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "Back" }));

            expect(useScreenStore.getState().screen).toBe("groups");
            expect(screen.getAllByRole("region", { name: /^Group \d$/ })).toHaveLength(2);
            expect(screen.getByRole("status")).toHaveTextContent("3 files marked for deletion");
        });
    });
});
