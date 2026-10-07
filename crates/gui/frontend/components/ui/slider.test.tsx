import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Slider } from "./slider";

/** A slider whose value is held by its parent, as a controlled one is in the app. */
const Controlled = ({ initial, step }: { initial: number; step: number }) => {
    const [value, setValue] = useState([initial]);

    return (
        <Slider
            aria-label="Amount"
            min={50}
            max={100}
            step={step}
            value={value}
            onValueChange={setValue}
            thumbClassName="thumb-hook"
        />
    );
};

describe("Slider", () => {
    it("renders a named slider with its bounds and value", () => {
        render(<Controlled initial={80} step={1} />);

        const slider = screen.getByRole("slider", { name: "Amount" });
        expect(slider).toHaveAttribute("aria-valuemin", "50");
        expect(slider).toHaveAttribute("aria-valuemax", "100");
        expect(slider).toHaveAttribute("aria-valuenow", "80");
        expect(slider).toHaveClass("thumb-hook");
    });

    it("raises the value by the step with the Right arrow", () => {
        render(<Controlled initial={80} step={5} />);
        const slider = screen.getByRole("slider");

        fireEvent.keyDown(slider, { key: "ArrowRight" });

        expect(slider).toHaveAttribute("aria-valuenow", "85");
    });
});
