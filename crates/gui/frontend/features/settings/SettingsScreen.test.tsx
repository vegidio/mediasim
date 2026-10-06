import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useScreenStore } from "@/stores/screen";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { SettingsScreen } from "./SettingsScreen";

const group = () => screen.getByRole("radiogroup", { name: "When deleting marked files" });
const option = (name: string) => screen.getByRole("radio", { name });
const confirm = () => screen.getByRole("switch", { name: "Confirm before deleting" });
const settings = () => {
    const { deletionMode, confirmDeletion } = useSettingsStore.getState();

    return { deletionMode, confirmDeletion };
};

describe("SettingsScreen", () => {
    beforeEach(() => {
        localStorage.clear();
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
    });

    it("shows Back, the heading, Reset to defaults and the Deleting files section", () => {
        render(<SettingsScreen />);

        expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Deleting files" })).toBeInTheDocument();
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

        expect(option("Move to Trash")).toHaveClass("data-checked:border-[#BEF264]");
        expect(option("Delete permanently")).toHaveClass("data-checked:border-[#F87171]");
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

    it("resets both settings to their defaults", () => {
        useSettingsStore.setState({ deletionMode: "permanent", confirmDeletion: false });
        render(<SettingsScreen />);

        fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

        expect(option("Move to Trash")).toBeChecked();
        expect(confirm()).toBeChecked();
        expect(settings()).toEqual(SETTINGS_DEFAULTS);
    });

    it("goes Back to the screen it was opened from", () => {
        useScreenStore.getState().show("pair");
        useScreenStore.getState().openSettings();
        render(<SettingsScreen />);

        fireEvent.click(screen.getByRole("button", { name: "Back" }));

        expect(useScreenStore.getState().screen).toBe("pair");
    });
});
