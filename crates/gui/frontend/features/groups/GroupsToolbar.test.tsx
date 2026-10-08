import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupsToolbar } from "./GroupsToolbar";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));

const SUMMARY = "18 similar files in 7 groups · 48 scanned · threshold 85%";

describe("GroupsToolbar", () => {
    it("shows Clear marks and Auto-select after the summary, each calling its handler", () => {
        const marking = { onClear: vi.fn(), onAutoSelect: vi.fn() };
        render(<GroupsToolbar summary={SUMMARY} marking={marking} />);

        const clear = screen.getByRole("button", { name: "Clear marks" });
        const auto = screen.getByRole("button", { name: "Auto-select" });
        expect(screen.getByText(SUMMARY).compareDocumentPosition(clear)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(clear.compareDocumentPosition(auto)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(auto.querySelector(".lucide-sparkles")).toHaveAttribute("aria-hidden", "true");
        expect(auto).toHaveClass("rounded-lg");

        fireEvent.click(clear);
        expect(marking.onClear).toHaveBeenCalledOnce();
        fireEvent.click(auto);
        expect(marking.onAutoSelect).toHaveBeenCalledOnce();
    });

    it("shows neither without marking", () => {
        render(<GroupsToolbar summary={SUMMARY} />);

        expect(screen.queryByRole("button", { name: "Clear marks" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Auto-select" })).not.toBeInTheDocument();
    });
});
