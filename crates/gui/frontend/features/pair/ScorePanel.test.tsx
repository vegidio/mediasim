import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScorePanel } from "./ScorePanel";

const panel = () => screen.getByRole("region", { name: "Similarity result" });

describe("ScorePanel", () => {
    it("is busy while comparing, with a status and no score", () => {
        render(<ScorePanel comparison={{ status: "comparing" }} onRetry={() => {}} />);

        expect(panel()).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("status")).toHaveTextContent("Comparing…");
        expect(panel()).not.toHaveTextContent("%");
        expect(screen.queryByTestId("score-fill")).not.toBeInTheDocument();
        expect(within(panel()).queryByRole("listitem", { current: true })).not.toBeInTheDocument();
    });

    it("shows the rounded score, its band, the bar at the score and the band emphasized", () => {
        render(<ScorePanel comparison={{ status: "done", similarity: 0.94522 }} onRetry={() => {}} />);

        expect(panel()).toHaveAttribute("aria-busy", "false");
        expect(panel()).toHaveTextContent("95%");
        expect(panel()).toHaveTextContent("Near identical");
        expect(screen.getByTestId("score-fill")).toHaveStyle({ width: "95%" });
        expect(screen.getByTestId("score-marker")).toHaveStyle({ left: "95%" });
        expect(within(panel()).getByRole("listitem", { current: true })).toHaveTextContent("Near-identical");
        expect(
            within(panel())
                .getAllByRole("listitem")
                .map((item) => item.textContent),
        ).toEqual(["Different", "Related", "Similar", "Near-identical"]);
    });

    it.each([
        ["done", { status: "done", similarity: 0.5 } as const, "border-border-strong"],
        ["comparing", { status: "comparing" } as const, "border-border"],
    ])("marks where Related, Similar and Near-identical begin while %s", (_, comparison, color) => {
        render(<ScorePanel comparison={comparison} onRetry={() => {}} />);

        const labels = screen.getAllByTestId("band-label");
        expect(labels.map((label) => label.classList.contains("border-l"))).toEqual([false, true, true, true]);
        for (const label of labels.slice(1)) expect(label).toHaveClass(color);
    });

    it("calls a 100% score Identical, emphasizing Near-identical", () => {
        render(<ScorePanel comparison={{ status: "done", similarity: 1 }} onRetry={() => {}} />);

        expect(panel()).toHaveTextContent("100%");
        expect(panel()).toHaveTextContent("Identical");
        expect(panel()).not.toHaveTextContent("Near identical");
        expect(within(panel()).getByRole("listitem", { current: true })).toHaveTextContent("Near-identical");
    });

    it("emphasizes the band a lower score falls in", () => {
        render(<ScorePanel comparison={{ status: "done", similarity: 0.29 }} onRetry={() => {}} />);

        expect(panel()).toHaveTextContent("29%");
        expect(within(panel()).getByRole("listitem", { current: true })).toHaveTextContent("Different");
    });

    it("alerts a load failure naming the file, and Try again retries", () => {
        const onRetry = vi.fn();
        render(
            <ScorePanel
                comparison={{
                    status: "failed",
                    error: {
                        kind: "load",
                        path: "/media/clip-b.mp4",
                        message: "failed to load video /media/clip-b.mp4",
                    },
                }}
                onRetry={onRetry}
            />,
        );

        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("Couldn't compare these files");
        expect(alert).toHaveTextContent("Couldn't load clip-b.mp4");
        expect(alert).toHaveTextContent("failed to load video /media/clip-b.mp4");
        expect(panel()).not.toHaveTextContent("%");

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        expect(onRetry).toHaveBeenCalledOnce();
    });

    it("names a Windows path's file", () => {
        render(
            <ScorePanel
                comparison={{ status: "failed", error: { kind: "load", path: "C:\\media\\b.mp4", message: "boom" } }}
                onRetry={() => {}}
            />,
        );

        expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load b.mp4");
    });

    it("explains a mismatch", () => {
        render(
            <ScorePanel
                comparison={{ status: "failed", error: { kind: "mismatch", message: "cannot compare" } }}
                onRetry={() => {}}
            />,
        );

        expect(screen.getByRole("alert")).toHaveTextContent("An image can't be compared with a video.");
    });
});
