import { act, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES, moveRule } from "@/features/groups/rules";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { DefaultRulesDialog } from "./DefaultRulesDialog";

/** The dialog with an Open button, closing when it asks to, as the Auto-select section does. */
const Harness = ({ onClose }: { onClose: () => void }) => {
    const [open, setOpen] = useState(true);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <DefaultRulesDialog
                open={open}
                onClose={() => {
                    onClose();
                    setOpen(false);
                }}
                onClosed={() => {}}
            />
        </>
    );
};

const show = () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    return onClose;
};

const dialog = () => screen.getByRole("dialog", { name: "Default auto-select rules" });
/** The rules' labels in the list's order, read off the switches. */
const order = () =>
    within(dialog())
        .getAllByRole("switch")
        .map((s) => s.getAttribute("aria-label"));

/** Lets dnd-kit's keyboard sensor start listening, which it does a tick after a row is lifted. */
const tick = () => act(() => new Promise((resolve) => setTimeout(resolve)));

/** Presses `code` on the focused element, where dnd-kit's keyboard sensor and the dialog read it. */
const press = async (code: string) => {
    const key = code === "Space" ? " " : code;
    await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key, code });
    });
    await tick();
};

/** "Oldest creation date" on and first. */
const CREATED_FIRST = moveRule(
    DEFAULT_RULES.map((rule) => (rule.id === "created" ? { ...rule, on: true } : rule)),
    3,
    0,
);

beforeEach(() => {
    useSettingsStore.setState(SETTINGS_DEFAULTS);
});

describe("DefaultRulesDialog", () => {
    it("opens with the saved rules, its title, its line and Save as default", () => {
        useSettingsStore.setState({ autoSelectRules: CREATED_FIRST });
        show();

        expect(order()[0]).toBe("Oldest creation date");
        expect(within(dialog()).getByRole("switch", { name: "Oldest creation date" })).toBeChecked();
        expect(dialog()).toHaveAccessibleDescription(
            "Used whenever you click Auto-select. Rules applied from the Auto-select menu are saved here too.",
        );
        expect(within(dialog()).getByRole("button", { name: "Save as default" })).toBeInTheDocument();
        expect(within(dialog()).queryByText(/^Will mark/)).not.toBeInTheDocument();
    });

    it("saves the rules as set on Save as default, and asks to close", () => {
        const onClose = show();
        fireEvent.click(within(dialog()).getByRole("switch", { name: "Largest file size" }));

        fireEvent.click(within(dialog()).getByRole("button", { name: "Save as default" }));

        expect(useSettingsStore.getState().autoSelectRules).toEqual(
            DEFAULT_RULES.map((rule) => (rule.id === "size" ? { id: "size", on: false } : rule)),
        );
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it.each(["Cancel", "Close", "Escape"])(
        "closes on %s without saving, and opens again with the saved rules",
        (how) => {
            const onClose = show();
            fireEvent.click(within(dialog()).getByRole("switch", { name: "Cleanest file name" }));

            if (how === "Escape") fireEvent.keyDown(dialog(), { key: "Escape", code: "Escape" });
            else fireEvent.click(within(dialog()).getByRole("button", { name: how }));

            expect(onClose).toHaveBeenCalled();
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);

            fireEvent.click(screen.getByRole("button", { name: "Open" }));

            expect(within(dialog()).getByRole("switch", { name: "Cleanest file name" })).toBeChecked();
        },
    );

    it("closes on a click on the dimmed screen without saving", async () => {
        const onClose = show();
        fireEvent.click(within(dialog()).getByRole("switch", { name: "Cleanest file name" }));
        // Radix starts listening for a press outside a tick after the dialog opens.
        await tick();

        // Radix closes on the click that follows a left-button press outside, not on the press alone.
        const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
        fireEvent.pointerDown(overlay, { button: 0 });
        fireEvent.click(overlay);

        expect(onClose).toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);
    });

    describe("from the keyboard", () => {
        beforeEach(() => {
            // jsdom has no layout: each row stands 60 px tall, one under the other, by its place in the list.
            const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
                this: Element,
            ) {
                const rows = [...document.querySelectorAll("li")];
                const index = rows.indexOf(this as HTMLLIElement);
                const top = Math.max(index, 0) * 60;
                const height = index < 0 ? 0 : 60;
                return { top, bottom: top + height, left: 0, right: 560, x: 0, y: top, width: 560, height } as DOMRect;
            });
            return () => rect.mockRestore();
        });

        it("forgets a row moved first on Cancel, and opens again with it last", async () => {
            const onClose = show();
            act(() => within(dialog()).getByRole("button", { name: "Reorder Cleanest file name" }).focus());

            await press("Space");
            for (let i = 0; i < 4; i++) await press("ArrowUp");
            await press("Space");
            expect(order()[0]).toBe("Cleanest file name");

            fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

            expect(onClose).toHaveBeenCalled();
            expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);

            fireEvent.click(screen.getByRole("button", { name: "Open" }));

            expect(order().at(-1)).toBe("Cleanest file name");
        });

        it("keeps the dialog open on Escape while a row is lifted, then closes unsaved on the next", async () => {
            const onClose = show();
            act(() => within(dialog()).getByRole("button", { name: "Reorder Highest resolution" }).focus());

            await press("Space");
            await press("ArrowDown");
            await press("Escape");

            expect(dialog()).toBeInTheDocument();
            expect(onClose).not.toHaveBeenCalled();
            expect(order()[1]).toBe("Highest resolution");

            await press("Escape");

            expect(onClose).toHaveBeenCalled();
            expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);
        });
    });
});
