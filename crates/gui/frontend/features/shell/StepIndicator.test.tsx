import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepIndicator } from "./StepIndicator";

describe("StepIndicator", () => {
    it("lists Select, Compare and Review in order, with Select current", () => {
        render(<StepIndicator current="select" />);

        const steps = within(screen.getByRole("navigation", { name: "Progress" })).getAllByRole("listitem");
        const visible = steps.filter((step) => step.getAttribute("aria-hidden") !== "true");

        expect(visible.map((step) => step.textContent)).toEqual(["1Select", "2Compare", "3Review"]);
        expect(visible.filter((step) => step.getAttribute("aria-current") === "step")).toEqual([visible[0]]);
    });

    it("marks exactly the step it is given", () => {
        render(<StepIndicator current="review" />);

        expect(screen.getByText("Review").closest("li")).toHaveAttribute("aria-current", "step");
        expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
    });

    it("has nothing interactive", () => {
        render(<StepIndicator current="select" />);

        expect(screen.queryAllByRole("button")).toEqual([]);
        expect(screen.queryAllByRole("link")).toEqual([]);
    });

    it("shows no step done on the first step", () => {
        render(<StepIndicator current="select" />);

        expect(screen.queryByRole("listitem", { name: /, done$/ })).toBeNull();
    });

    it("shows Select done, Compare current and Review numbered on the Compare step", () => {
        render(<StepIndicator current="compare" />);

        const select = screen.getByRole("listitem", { name: "Select, done" });
        expect(select).not.toHaveAttribute("aria-current");
        expect(select.querySelector("svg")).not.toBeNull();
        expect(select).not.toHaveTextContent("1");
        expect(screen.getByText("Compare").closest("li")).toHaveAttribute("aria-current", "step");
        expect(screen.getByText("Review").closest("li")).toHaveTextContent("3Review");
    });

    it("shows Select and Compare done on the Review step", () => {
        render(<StepIndicator current="review" />);

        expect(screen.getByRole("listitem", { name: "Select, done" })).toBeInTheDocument();
        expect(screen.getByRole("listitem", { name: "Compare, done" })).toBeInTheDocument();
        expect(screen.getByText("Review").closest("li")).toHaveAttribute("aria-current", "step");
    });
});
