import { act } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES } from "@/lib/rules";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { SettingsScreen } from "./SettingsScreen";

const group = () => screen.getByRole("radiogroup", { name: "When deleting marked files" });
const option = (name: string) => screen.getByRole("radio", { name });
const confirm = () => screen.getByRole("switch", { name: "Confirm before deleting" });
const threshold = () => screen.getByRole("slider", { name: "Default match threshold" });
const toggle = (name: string) => screen.getByRole("switch", { name });
const settings = () => {
    const { deletionMode, confirmDeletion, matchThreshold, scanSubfolders, frameRotate, frameFlip, autoSelectRules } =
        useSettingsStore.getState();

    return { deletionMode, confirmDeletion, matchThreshold, scanSubfolders, frameRotate, frameFlip, autoSelectRules };
};

describe("SettingsScreen", () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows Back, the heading, Reset to defaults, then the Comparison, Auto-select and Deleting files sections", () => {
        render(<SettingsScreen />);

        expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeInTheDocument();
        expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby"))).toEqual([
            screen.getByRole("heading", { level: 2, name: "Comparison" }).id,
            screen.getByRole("heading", { level: 2, name: "Auto-select" }).id,
            screen.getByRole("heading", { level: 2, name: "Deleting files" }).id,
        ]);
    });

    it("shows the Comparison defaults, each control named and described by its row", () => {
        render(<SettingsScreen />);

        expect(threshold()).toHaveAttribute("aria-valuenow", "80");
        expect(threshold()).toHaveAttribute("aria-valuemin", "50");
        expect(threshold()).toHaveAttribute("aria-valuemax", "100");
        expect(threshold()).toHaveAccessibleDescription(
            "Files at or above this similarity are grouped. You can still change it per scan.",
        );
        expect(screen.getByText("80%")).toBeInTheDocument();
        expect(toggle("Scan subfolders")).not.toBeChecked();
        expect(toggle("Scan subfolders")).toHaveAccessibleDescription(
            "Include files inside nested folders by default.",
        );
        expect(toggle("Frame rotate")).toBeChecked();
        expect(toggle("Frame rotate")).toHaveAccessibleDescription(
            "Also compare each frame rotated 90°, 180° and 270°.",
        );
        expect(toggle("Frame flip")).toBeChecked();
        expect(toggle("Frame flip")).toHaveAccessibleDescription(
            "Also compare each frame flipped vertically and horizontally.",
        );
    });

    it("shows the threshold's value as it changes", () => {
        render(<SettingsScreen />);

        act(() => useSettingsStore.getState().update({ matchThreshold: 92 }));

        expect(threshold()).toHaveAttribute("aria-valuenow", "92");
        expect(screen.getByText("92%")).toBeInTheDocument();
    });

    it("shows the threshold's value while the slider is dragged", () => {
        // jsdom has no layout or pointer capture, so the track gets a 500 px box: 10 px per percent from 50 to 100.
        render(<SettingsScreen />);
        const root = threshold().closest<HTMLElement>("[data-slot='slider']");
        if (!root) throw new Error("the threshold slider has no root");
        const captured = new Set<number>();
        Object.assign(root, {
            setPointerCapture: (id: number) => void captured.add(id),
            hasPointerCapture: (id: number) => captured.has(id),
            releasePointerCapture: (id: number) => void captured.delete(id),
        });
        vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
            DOMRect.fromRect({ x: 0, y: 0, width: 500, height: 4 }),
        );

        fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 300 });
        fireEvent.pointerMove(root, { pointerId: 1, clientX: 420 });

        expect(threshold()).toHaveAttribute("aria-valuenow", "92");
        expect(screen.getByText("92%")).toBeInTheDocument();
        expect(settings().matchThreshold).toBe(92);

        fireEvent.pointerUp(root, { pointerId: 1, clientX: 420 });
    });

    it("moves the threshold by 1% with the arrow keys, in the store at once", () => {
        render(<SettingsScreen />);

        fireEvent.keyDown(threshold(), { key: "ArrowRight" });

        expect(screen.getByText("81%")).toBeInTheDocument();
        expect(settings().matchThreshold).toBe(81);

        fireEvent.keyDown(threshold(), { key: "ArrowLeft" });
        fireEvent.keyDown(threshold(), { key: "ArrowLeft" });

        expect(screen.getByText("79%")).toBeInTheDocument();
        expect(settings().matchThreshold).toBe(79);
    });

    it("keeps the threshold at 100% at its top", () => {
        useSettingsStore.setState({ matchThreshold: 100 });
        render(<SettingsScreen />);

        fireEvent.keyDown(threshold(), { key: "ArrowRight" });

        expect(screen.getByText("100%")).toBeInTheDocument();
        expect(settings().matchThreshold).toBe(100);
    });

    it("doesn't move the threshold when its row's text is pressed", () => {
        render(<SettingsScreen />);

        fireEvent.click(screen.getByText("Default match threshold"));

        expect(settings().matchThreshold).toBe(80);
    });

    it.each([
        ["Scan subfolders", "scanSubfolders", true],
        ["Frame rotate", "frameRotate", false],
        ["Frame flip", "frameFlip", false],
    ] as const)("toggles %s, in the store at once", (name, key, toggled) => {
        render(<SettingsScreen />);

        fireEvent.click(toggle(name));

        expect(toggle(name)).toHaveAttribute("aria-checked", String(toggled));
        expect(settings()[key]).toBe(toggled);
    });

    it("shows the defaults: Move to Trash selected, and confirmation on", () => {
        render(<SettingsScreen />);

        expect(group()).toBeInTheDocument();
        expect(option("Move to Trash")).toBeChecked();
        expect(option("Move to Trash")).toHaveAccessibleDescription("Files can be restored from the Trash.");
        expect(option("Delete permanently")).not.toBeChecked();
        expect(option("Delete permanently")).toHaveAccessibleDescription(
            "Frees space immediately. This cannot be undone.",
        );
        expect(confirm()).toBeChecked();
        expect(confirm()).toHaveAccessibleDescription("Show a summary of the marked files before anything is removed.");
    });

    it("selects Delete permanently when its row is activated, in the store at once", () => {
        render(<SettingsScreen />);

        fireEvent.click(screen.getByText("Frees space immediately. This cannot be undone."));

        expect(option("Delete permanently")).toBeChecked();
        expect(option("Move to Trash")).not.toBeChecked();
        expect(settings().deletionMode).toBe("permanent");
    });

    it("draws the selected indicator green for the Trash and red for permanent deletion", () => {
        render(<SettingsScreen />);

        expect(option("Move to Trash")).toHaveClass("data-checked:border-primary");
        expect(option("Delete permanently")).toHaveClass("data-checked:border-danger-bright");
    });

    it("moves the selection with the Down arrow", async () => {
        render(<SettingsScreen />);
        act(() => option("Move to Trash").focus());

        fireEvent.keyDown(option("Move to Trash"), { key: "ArrowDown" });
        // Radix's roving focus moves focus, and so selects, on the next task.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

        expect(option("Delete permanently")).toBeChecked();
        expect(settings().deletionMode).toBe("permanent");
    });

    it("toggles confirmation, in the store at once", () => {
        render(<SettingsScreen />);

        fireEvent.click(confirm());

        expect(confirm()).not.toBeChecked();
        expect(settings().confirmDeletion).toBe(false);
    });

    it("resets the Comparison settings to their defaults", () => {
        useSettingsStore.setState({ matchThreshold: 65, scanSubfolders: true, frameRotate: false, frameFlip: false });
        render(<SettingsScreen />);

        fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

        expect(threshold()).toHaveAttribute("aria-valuenow", "80");
        expect(screen.getByText("80%")).toBeInTheDocument();
        expect(toggle("Scan subfolders")).not.toBeChecked();
        expect(toggle("Frame rotate")).toBeChecked();
        expect(toggle("Frame flip")).toBeChecked();
        expect(settings()).toEqual(SETTINGS_DEFAULTS);
    });

    it("resets both settings to their defaults", () => {
        useSettingsStore.setState({ deletionMode: "permanent", confirmDeletion: false });
        render(<SettingsScreen />);

        fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

        expect(option("Move to Trash")).toBeChecked();
        expect(confirm()).toBeChecked();
        expect(settings()).toEqual(SETTINGS_DEFAULTS);
    });

    it("resets the Auto-select rules to their defaults, and shows them", () => {
        useSettingsStore.setState({
            autoSelectRules: [
                { id: "created", on: true },
                { id: "duration", on: true },
                { id: "resolution", on: true },
                { id: "size", on: true },
                { id: "name", on: true },
            ],
        });
        render(<SettingsScreen />);

        fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

        expect(useSettingsStore.getState().autoSelectRules).toEqual(DEFAULT_RULES);
        expect(
            within(screen.getByRole("list", { name: "Default rules" }))
                .getAllByRole("listitem")
                .map((item) => item.textContent?.replace("›", "").trim()),
        ).toEqual(["1 Longest video length", "2 Highest resolution", "3 Largest file size", "4 Cleanest file name"]);
    });

    it("goes Back to the screen it was opened from", () => {
        useScreenStore.getState().show("pair");
        useScreenStore.getState().openSettings();
        render(<SettingsScreen />);

        fireEvent.click(screen.getByRole("button", { name: "Back" }));

        expect(useScreenStore.getState().screen).toBe("pair");
    });
});
