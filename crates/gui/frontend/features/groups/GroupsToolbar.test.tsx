import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupsToolbar } from "./GroupsToolbar";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));

const SUMMARY = "18 similar files in 7 groups · 48 scanned · threshold 85%";

describe("GroupsToolbar", () => {
    const marking = () => ({ onClear: vi.fn(), onAutoSelect: vi.fn(), onChooseRules: vi.fn(), refocus: vi.fn() });

    it("shows Clear marks and the Auto-select split button after the summary, each calling its handler", () => {
        const handlers = marking();
        render(<GroupsToolbar summary={SUMMARY} marking={handlers} />);

        const clear = screen.getByRole("button", { name: "Clear marks" });
        const auto = screen.getByRole("button", { name: "Auto-select" });
        const chevron = screen.getByRole("button", { name: "More auto-select options" });
        expect(screen.getByText(SUMMARY).compareDocumentPosition(clear)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(clear.compareDocumentPosition(auto)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(auto.nextElementSibling).toBe(chevron);
        expect(auto.querySelector(".lucide-sparkles")).toHaveAttribute("aria-hidden", "true");
        expect(auto).toHaveClass("rounded-lg", "rounded-r-none");
        expect(chevron).toHaveClass("rounded-l-none");
        expect(chevron).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(clear);
        expect(handlers.onClear).toHaveBeenCalledOnce();
        fireEvent.click(auto);
        expect(handlers.onAutoSelect).toHaveBeenCalledOnce();
    });

    it("keeps focus where it is when Auto-select is pressed", () => {
        render(<GroupsToolbar summary={SUMMARY} marking={marking()} />);

        // jsdom moves no focus on a press, so this checks what keeps the browser from moving it.
        expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Auto-select" }))).toBe(false);
    });

    it("shows none of them without marking", () => {
        render(<GroupsToolbar summary={SUMMARY} />);

        expect(screen.queryByRole("button", { name: "Clear marks" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Auto-select" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "More auto-select options" })).not.toBeInTheDocument();
    });
});
