import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

const Example = () => {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>Show</DialogTrigger>
            <DialogContent aria-describedby={undefined}>
                <DialogTitle>Media details: a.jpg</DialogTitle>
                <button type="button">First</button>
                <DialogClose>Close</DialogClose>
            </DialogContent>
        </Dialog>
    );
};

describe("Dialog", () => {
    it("opens as a named, modal dialog over a dimmed overlay", () => {
        render(<Example />);

        fireEvent.click(screen.getByRole("button", { name: "Show" }));

        const dialog = screen.getByRole("dialog", { name: "Media details: a.jpg" });
        expect(dialog.parentElement).toHaveClass("bg-black/70");
    });

    it("moves focus into the dialog and keeps the rest of the page out of reach", () => {
        render(<Example />);
        const trigger = screen.getByRole("button", { name: "Show" });

        fireEvent.click(trigger);

        expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
        // Radix hides everything outside a modal dialog from assistive technology, so only the dialog's buttons remain.
        expect(screen.queryByRole("button", { name: "Show" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "First" })).toBeInTheDocument();
    });

    it("closes on Escape", () => {
        render(<Example />);
        fireEvent.click(screen.getByRole("button", { name: "Show" }));

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});
