import { act, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import { DEFAULT_RULES, moveRule, type Rule } from "@/lib/rules";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { AutoSelectDialog } from "./AutoSelectDialog";

const image = (path: string, size: number, created: string): GroupFile => ({
    path,
    type: "image",
    width: 4032,
    height: 3024,
    size,
    created,
});

/** The spec's one group: `DSC_0193.HEIC`, larger and newer, and `DSC_0193.jpg`. */
const DSC = [
    {
        files: [
            image("/p/DSC_0193.HEIC", 4_100_000, "2025-06-02T00:00:00Z"),
            image("/p/DSC_0193.jpg", 3_200_000, "2025-06-01T00:00:00Z"),
        ],
    },
];

type Handlers = { onApply: (rules: Rule[]) => void; onClose: () => void };

/** The dialog with an Open button, closing on its own close and on Apply, as the groups screen does. */
const Harness = ({ onApply, onClose }: Handlers) => {
    const [open, setOpen] = useState(true);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <AutoSelectDialog
                open={open}
                groups={DSC}
                onApply={(rules) => {
                    onApply(rules);
                    setOpen(false);
                }}
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
    const handlers = { onApply: vi.fn(), onClose: vi.fn() };
    render(<Harness {...handlers} />);
    return handlers;
};

const dialog = () => screen.getByRole("dialog", { name: "Auto-select" });
/** The rules' labels in the list's order, read off the switches. */
const order = () =>
    within(dialog())
        .getAllByRole("switch")
        .map((s) => s.getAttribute("aria-label"));
/** The preview's text. */
const previewText = () => within(dialog()).getByText(/^Will mark/).textContent;

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

describe("AutoSelectDialog", () => {
    it("opens with the saved rules, the preview and one group to apply to", () => {
        useSettingsStore.setState({ autoSelectRules: CREATED_FIRST });
        show();

        expect(order()).toEqual([
            "Oldest creation date",
            "Longest video length",
            "Highest resolution",
            "Largest file size",
            "Cleanest file name",
        ]);
        expect(within(dialog()).getByRole("switch", { name: "Oldest creation date" })).toBeChecked();
        expect(
            within(dialog()).getByText(
                "Keep one file per group. Everything else is marked for deletion — nothing is removed until you confirm.",
            ),
        ).toBeInTheDocument();
        expect(previewText()).toBe("Will mark 1 of 2 grouped files · 4.1 MB freed");
        expect(within(dialog()).getByRole("button", { name: "Apply to 1 group" })).toBeInTheDocument();
    });

    it("updates the preview when a rule is switched", () => {
        show();
        expect(previewText()).toBe("Will mark 1 of 2 grouped files · 3.2 MB freed");

        // With the size off, the two tie down to the path, and the HEIC sorts first.
        fireEvent.click(within(dialog()).getByRole("switch", { name: "Largest file size" }));

        expect(previewText()).toBe("Will mark 1 of 2 grouped files · 3.2 MB freed");

        fireEvent.click(within(dialog()).getByRole("switch", { name: "Oldest creation date" }));

        expect(previewText()).toBe("Will mark 1 of 2 grouped files · 4.1 MB freed");
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

        it("updates the preview when the creation date is turned on and moved first", async () => {
            show();
            fireEvent.click(within(dialog()).getByRole("switch", { name: "Oldest creation date" }));
            act(() => within(dialog()).getByRole("button", { name: "Reorder Oldest creation date" }).focus());

            await press("Space");
            for (let i = 0; i < 3; i++) await press("ArrowUp");
            await press("Space");

            expect(order()[0]).toBe("Oldest creation date");
            expect(previewText()).toBe("Will mark 1 of 2 grouped files · 4.1 MB freed");
        });

        it("keeps the dialog open on Escape while a row is lifted, then closes on the next", async () => {
            const { onClose } = show();
            act(() => within(dialog()).getByRole("button", { name: "Reorder Highest resolution" }).focus());

            await press("Space");
            await press("ArrowDown");
            await press("Escape");

            expect(dialog()).toBeInTheDocument();
            expect(onClose).not.toHaveBeenCalled();
            expect(order()[1]).toBe("Highest resolution");

            await press("Escape");

            expect(onClose).toHaveBeenCalled();
        });
    });

    it("hands the rules as set to onApply, without saving them itself", () => {
        const { onApply, onClose } = show();
        fireEvent.click(within(dialog()).getByRole("switch", { name: "Cleanest file name" }));

        fireEvent.click(within(dialog()).getByRole("button", { name: "Apply to 1 group" }));

        expect(onApply).toHaveBeenCalledWith(
            DEFAULT_RULES.map((rule) => (rule.id === "name" ? { id: "name", on: false } : rule)),
        );
        expect(onClose).not.toHaveBeenCalled();
        expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);
    });

    it.each(["Cancel", "Close", "Escape"])(
        "closes on %s without saving, and opens again with the saved rules",
        (how) => {
            const { onApply, onClose } = show();
            fireEvent.click(within(dialog()).getByRole("switch", { name: "Cleanest file name" }));

            if (how === "Escape") fireEvent.keyDown(dialog(), { key: "Escape", code: "Escape" });
            else fireEvent.click(within(dialog()).getByRole("button", { name: how }));

            expect(onClose).toHaveBeenCalled();
            expect(onApply).not.toHaveBeenCalled();
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(useSettingsStore.getState().autoSelectRules).toBe(DEFAULT_RULES);

            fireEvent.click(screen.getByRole("button", { name: "Open" }));

            expect(within(dialog()).getByRole("switch", { name: "Cleanest file name" })).toBeChecked();
        },
    );
});
