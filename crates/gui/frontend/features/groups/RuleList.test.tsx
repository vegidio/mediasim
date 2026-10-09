import { act, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { DEFAULT_RULES, RULE_INFO, type Rule } from "@/lib/rules";
import { RuleList } from "./RuleList";

/** The list, holding its rules as a dialog would, and reporting each change to `onChange`. */
const Harness = ({ onChange }: { onChange: (rules: Rule[]) => void }) => {
    const [rules, setRules] = useState<readonly Rule[]>(DEFAULT_RULES);

    return (
        <RuleList
            rules={rules}
            onChange={(next) => {
                setRules(next);
                onChange(next);
            }}
        />
    );
};

/** Each row's rank and label, in order. */
const rows = () =>
    screen.getAllByRole("listitem").map((row) => {
        const rank = row.querySelector(".font-mono")?.textContent;
        const grip = within(row).getByRole("button", { name: /^Reorder / });
        return `${rank} ${grip.getAttribute("aria-label")?.replace("Reorder ", "")}`;
    });

const labelOf = (name: string) =>
    within(screen.getAllByRole("listitem").find((row) => row.textContent?.includes(name)) as HTMLElement).getByText(
        name,
    );

/** Lets dnd-kit's keyboard sensor start listening, which it does a tick after a row is lifted. */
const tick = () => act(() => new Promise((resolve) => setTimeout(resolve)));

/** Presses `code` on the focused element, where dnd-kit's keyboard sensor reads it. */
const press = async (code: string) => {
    const key = code === "Space" ? " " : code;
    await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key, code });
    });
    await tick();
};

/** Fires a pointer event where dnd-kit's pointer sensor reads it, then lets it measure and re-render. */
const pointer = async (fire: () => void) => {
    await act(async () => fire());
    await tick();
};

/** jsdom has no layout: each row stands 60 px tall, one under the other, by its place in the list. */
const layOutRows = () =>
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const rows = [...document.querySelectorAll("li")];
        const index = rows.indexOf(this as HTMLLIElement);
        const top = Math.max(index, 0) * 60;
        const height = index < 0 ? 0 : 60;
        return { top, bottom: top + height, left: 0, right: 560, x: 0, y: top, width: 560, height } as DOMRect;
    });

describe("RuleList", () => {
    it("shows the default rules with their ranks, the Videos only pill, and the creation date off", () => {
        render(<Harness onChange={() => {}} />);

        expect(screen.getByText("Keep the file with…")).toBeInTheDocument();
        expect(screen.getByText("Drag to reorder · first rule wins")).toBeInTheDocument();
        expect(rows()).toEqual([
            "1 Longest video length",
            "2 Highest resolution",
            "3 Largest file size",
            "4 Oldest creation date",
            "5 Cleanest file name",
        ]);
        expect(screen.getByTitle("Applies to video files only")).toHaveTextContent("Videos only");
        expect(screen.getAllByText("Videos only")).toHaveLength(1);
        expect(screen.getByRole("switch", { name: "Oldest creation date" })).not.toBeChecked();
        expect(labelOf("Oldest creation date")).toHaveClass("text-muted-foreground");
        for (const name of ["Longest video length", "Highest resolution", "Largest file size", "Cleanest file name"]) {
            expect(screen.getByRole("switch", { name })).toBeChecked();
            expect(labelOf(name)).toHaveClass("text-foreground");
        }
        for (const { id } of DEFAULT_RULES) {
            expect(screen.getByRole("button", { name: `Reorder ${RULE_INFO[id].label}` })).toBeInTheDocument();
            expect(screen.getByText(RULE_INFO[id].hint)).toBeInTheDocument();
        }
    });

    it("switches a rule off through onChange, greying its label", () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        fireEvent.click(screen.getByRole("switch", { name: "Largest file size" }));

        expect(onChange).toHaveBeenLastCalledWith(
            DEFAULT_RULES.map((rule) => (rule.id === "size" ? { id: "size", on: false } : rule)),
        );
        expect(screen.getByRole("switch", { name: "Largest file size" })).not.toBeChecked();
        expect(labelOf("Largest file size")).toHaveClass("text-muted-foreground");
    });

    describe("with the pointer", () => {
        let rect: MockInstance;

        beforeEach(() => {
            rect = layOutRows();
        });

        afterEach(() => rect.mockRestore());

        it("moves a dragged row where it is dropped, renumbering the ranks", async () => {
            const onChange = vi.fn();
            render(<Harness onChange={onChange} />);
            const row = screen
                .getByRole("button", { name: "Reorder Oldest creation date" })
                .closest("li") as HTMLElement;

            // From the middle of the 4th row to above the 1st one, past the few pixels that start a drag.
            await pointer(() => fireEvent.pointerDown(row, { isPrimary: true, button: 0, clientX: 100, clientY: 210 }));
            await pointer(() => fireEvent.pointerMove(document, { clientX: 100, clientY: 200 }));
            await pointer(() => fireEvent.pointerMove(document, { clientX: 100, clientY: 10 }));
            await pointer(() => fireEvent.pointerUp(document, { clientX: 100, clientY: 10 }));

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(rows()).toEqual([
                "1 Oldest creation date",
                "2 Longest video length",
                "3 Highest resolution",
                "4 Largest file size",
                "5 Cleanest file name",
            ]);
            expect(screen.getByRole("switch", { name: "Oldest creation date" })).not.toBeChecked();
        });

        it("never starts a drag from a press on a switch", async () => {
            const onChange = vi.fn();
            const onDraggingChange = vi.fn();
            render(<RuleList rules={DEFAULT_RULES} onChange={onChange} onDraggingChange={onDraggingChange} />);
            const toggle = screen.getByRole("switch", { name: "Largest file size" });

            await pointer(() =>
                fireEvent.pointerDown(toggle, { isPrimary: true, button: 0, clientX: 520, clientY: 150 }),
            );
            await pointer(() => fireEvent.pointerMove(document, { clientX: 520, clientY: 30 }));
            await pointer(() => fireEvent.pointerUp(document, { clientX: 520, clientY: 30 }));

            expect(onDraggingChange).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
            expect(rows()[2]).toBe("3 Largest file size");
        });
    });

    describe("from the keyboard", () => {
        let rect: MockInstance;

        beforeEach(() => {
            rect = layOutRows();
        });

        afterEach(() => rect.mockRestore());

        it("moves a rule up two places, announcing where it was dropped", async () => {
            const onChange = vi.fn();
            render(<Harness onChange={onChange} />);
            act(() => screen.getByRole("button", { name: "Reorder Cleanest file name" }).focus());

            await press("Space");
            expect(screen.getByText("Picked up Cleanest file name, in place 5.")).toBeInTheDocument();
            await press("ArrowUp");
            await press("ArrowUp");
            await press("Space");

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange.mock.calls[0]?.[0].map((rule: Rule) => rule.id)).toEqual([
                "duration",
                "resolution",
                "name",
                "size",
                "created",
            ]);
            expect(rows()[2]).toBe("3 Cleanest file name");
            expect(screen.getByText("Cleanest file name dropped in place 3.")).toBeInTheDocument();
        });

        it("puts a lifted rule back on Escape", async () => {
            const onChange = vi.fn();
            const onDraggingChange = vi.fn();
            render(<RuleList rules={DEFAULT_RULES} onChange={onChange} onDraggingChange={onDraggingChange} />);
            act(() => screen.getByRole("button", { name: "Reorder Highest resolution" }).focus());

            await press("Space");
            expect(onDraggingChange).toHaveBeenLastCalledWith(true);
            await press("ArrowDown");
            await press("Escape");

            expect(onChange).not.toHaveBeenCalled();
            expect(onDraggingChange).toHaveBeenLastCalledWith(false);
            expect(rows()[1]).toBe("2 Highest resolution");
            expect(screen.getByText("Highest resolution returned to place 2.")).toBeInTheDocument();
        });

        it("doesn't lift a row on Space on its switch", async () => {
            const onDraggingChange = vi.fn();
            render(<RuleList rules={DEFAULT_RULES} onChange={() => {}} onDraggingChange={onDraggingChange} />);
            act(() => screen.getByRole("switch", { name: "Highest resolution" }).focus());

            await press("Space");

            expect(onDraggingChange).not.toHaveBeenCalled();
        });
    });
});
