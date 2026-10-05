import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkButton } from "./MarkButton";

/** The text a sighted user sees: everything but the visually hidden parts, with spaces collapsed. */
const visibleText = (element: HTMLElement) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const hidden of clone.querySelectorAll(".sr-only")) hidden.remove();
    return clone.textContent?.replace(/\s+/g, " ").trim();
};

describe("MarkButton", () => {
    it("reads Mark for deletion in a pane, named with its badge letter", () => {
        render(<MarkButton slot="a" marked={false} onToggle={() => {}} variant="pane" />);

        const button = screen.getByRole("button", { name: "Mark A for deletion" });
        expect(visibleText(button)).toBe("Mark for deletion");
    });

    it("reads Marked · Undo when marked, named with its badge letter", () => {
        render(<MarkButton slot="a" marked onToggle={() => {}} variant="pane" />);

        const button = screen.getByRole("button", { name: "A Marked · Undo" });
        expect(visibleText(button)).toBe("Marked · Undo");
    });

    it("names the file in the slider's visible text", () => {
        render(<MarkButton slot="b" marked={false} onToggle={() => {}} variant="slider" />);

        const button = screen.getByRole("button", { name: "Mark B for deletion" });
        expect(visibleText(button)).toBe("Mark B for deletion");
    });

    it("reads Marked · Undo in the slider too, named with its badge letter", () => {
        render(<MarkButton slot="b" marked onToggle={() => {}} variant="slider" />);

        const button = screen.getByRole("button", { name: "B Marked · Undo" });
        expect(visibleText(button)).toBe("Marked · Undo");
    });

    it("calls onToggle on a click", () => {
        const onToggle = vi.fn();
        render(<MarkButton slot="a" marked={false} onToggle={onToggle} variant="pane" />);

        fireEvent.click(screen.getByRole("button"));

        expect(onToggle).toHaveBeenCalledOnce();
    });

    it.each([false, true])("has no aria-pressed when marked is %s", (marked) => {
        render(<MarkButton slot="a" marked={marked} onToggle={() => {}} variant="pane" />);

        expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");
    });

    it("shows a trash icon and a focus ring", () => {
        render(<MarkButton slot="a" marked={false} onToggle={() => {}} variant="pane" />);

        expect(screen.getByRole("button").querySelector(".lucide-trash-2")).toBeInTheDocument();
        expect(screen.getByRole("button")).toHaveClass("focus-visible:ring-3");
    });
});
