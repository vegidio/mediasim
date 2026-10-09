import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RULES, type Rule } from "@/features/groups/rules";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { AutoSelectSection } from "./AutoSelectSection";

const list = () => screen.getByRole("list", { name: "Default rules" });
/** The chips' text, read off the list's items. */
const chips = () =>
    within(list())
        .getAllByRole("listitem")
        .map((item) => item.textContent?.replace("›", "").trim());
const editRules = () => screen.getByRole("button", { name: "Edit rules" });
const dialog = () => screen.getByRole("dialog", { name: "Default auto-select rules" });

/** "Oldest creation date" on and first, and "Largest file size" off. */
const REORDERED: Rule[] = [
    { id: "created", on: true },
    { id: "duration", on: true },
    { id: "resolution", on: true },
    { id: "size", on: false },
    { id: "name", on: true },
];

beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
});

describe("AutoSelectSection", () => {
    it("shows the default rules that are on as numbered chips, and Edit rules", () => {
        render(<AutoSelectSection />);

        expect(screen.getByRole("region", { name: "Auto-select" })).toBeInTheDocument();
        expect(chips()).toEqual([
            "1 Longest video length",
            "2 Highest resolution",
            "3 Largest file size",
            "4 Cleanest file name",
        ]);
        expect(editRules()).toBeInTheDocument();
    });

    it("leaves out a rule that is off and ranks only the rules shown", () => {
        useSettingsStore.setState({ autoSelectRules: REORDERED });
        render(<AutoSelectSection />);

        expect(chips()).toEqual([
            "1 Oldest creation date",
            "2 Longest video length",
            "3 Highest resolution",
            "4 Cleanest file name",
        ]);
    });

    it("shows All rules are off, and no chip, when every rule is off", () => {
        useSettingsStore.setState({ autoSelectRules: DEFAULT_RULES.map(({ id }) => ({ id, on: false })) });
        render(<AutoSelectSection />);

        expect(screen.getByText("All rules are off")).toBeInTheDocument();
        expect(screen.queryByRole("list", { name: "Default rules" })).not.toBeInTheDocument();
        expect(editRules()).toBeInTheDocument();
    });

    it("hides the separators from assistive technology, one between each two chips", () => {
        render(<AutoSelectSection />);

        const separators = within(list()).getAllByText("›");
        expect(separators).toHaveLength(3);
        for (const separator of separators) expect(separator).toHaveAttribute("aria-hidden", "true");
    });

    it("follows a change to the rules made outside the section", () => {
        render(<AutoSelectSection />);

        act(() => useSettingsStore.getState().update({ autoSelectRules: REORDERED }));

        expect(chips()[0]).toBe("1 Oldest creation date");
        expect(chips()).toHaveLength(4);
        expect(chips()).not.toContain("3 Largest file size");
    });

    it("opens the default rules dialog from Edit rules", () => {
        render(<AutoSelectSection />);

        fireEvent.click(editRules());

        expect(dialog()).toBeInTheDocument();
    });

    it("updates the chips on Save as default, with focus back on Edit rules", async () => {
        render(<AutoSelectSection />);
        fireEvent.click(editRules());
        fireEvent.click(within(dialog()).getByRole("switch", { name: "Largest file size" }));

        fireEvent.click(within(dialog()).getByRole("button", { name: "Save as default" }));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(chips()).toEqual(["1 Longest video length", "2 Highest resolution", "3 Cleanest file name"]);
        // Radix returns focus once the dialog has unmounted, a task later.
        await waitFor(() => expect(editRules()).toHaveFocus());
    });

    it("keeps the chips on Cancel, with focus back on Edit rules", async () => {
        render(<AutoSelectSection />);
        fireEvent.click(editRules());
        fireEvent.click(within(dialog()).getByRole("switch", { name: "Largest file size" }));

        fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(chips()).toHaveLength(4);
        // Radix returns focus once the dialog has unmounted, a task later.
        await waitFor(() => expect(editRules()).toHaveFocus());
    });
});
