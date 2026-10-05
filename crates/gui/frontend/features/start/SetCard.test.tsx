import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStartStore } from "@/stores/start";
import { SetCard } from "./SetCard";

describe("SetCard", () => {
    beforeEach(() => {
        useStartStore.setState(useStartStore.getInitialState(), true);
    });

    it("shows its title and description", () => {
        render(<SetCard />);

        expect(screen.getByRole("region", { name: "Find similar in a set" })).toHaveTextContent(
            "Group lookalikes across many files, then clean up the extras.",
        );
    });

    it("has an operable drop area that opens a menu", () => {
        render(<SetCard />);

        const dropArea = screen.getByRole("button", { name: /Drop files or folders here/ });
        expect(dropArea).toHaveTextContent("or click to browse");
        expect(dropArea).toBeEnabled();
        expect(dropArea).toHaveAttribute("aria-haspopup", "menu");
    });

    it("has Continue disabled", () => {
        render(<SetCard />);

        expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    });

    it("starts with Scan subfolders checked", () => {
        render(<SetCard />);

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).toBeChecked();
    });

    it("toggles Scan subfolders from the box", () => {
        render(<SetCard />);
        const checkbox = screen.getByRole("checkbox", { name: "Scan subfolders" });

        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
        expect(useStartStore.getState().scanSubfolders).toBe(false);

        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();
    });

    it("toggles Scan subfolders from its label", () => {
        render(<SetCard />);

        fireEvent.click(screen.getByText("Scan subfolders"));

        expect(screen.getByRole("checkbox", { name: "Scan subfolders" })).not.toBeChecked();
        expect(useStartStore.getState().scanSubfolders).toBe(false);
    });
});
