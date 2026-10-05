import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PairCard } from "./PairCard";

describe("PairCard", () => {
    it("shows its title and description", () => {
        render(<PairCard />);

        expect(screen.getByRole("region", { name: "Compare two files" })).toHaveTextContent(
            "Get one similarity score for two images or two videos.",
        );
    });

    it("has both file slots empty and disabled", () => {
        render(<PairCard />);

        for (const name of ["File A", "File B"]) {
            const slot = screen.getByRole("button", { name });

            expect(slot).toHaveAccessibleDescription("Drop or click to choose");
            expect(slot).toBeDisabled();
        }
    });

    it("shows the images-or-videos hint", () => {
        render(<PairCard />);

        expect(screen.getByText("Both files must be images, or both videos.")).toBeInTheDocument();
    });

    it("has Compare disabled", () => {
        render(<PairCard />);

        expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    });
});
