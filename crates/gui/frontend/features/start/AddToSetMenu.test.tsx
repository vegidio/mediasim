import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetCard } from "./SetCard";

// Exercised through the set card, which owns the drop area that opens it.
const dropArea = () => screen.getByRole("button", { name: /Drop files or folders here/ });

describe("AddToSetMenu", () => {
    it("is closed until the drop area is clicked", () => {
        render(<SetCard />);

        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
        expect(dropArea()).toHaveAttribute("aria-expanded", "false");
    });

    it("opens at the click point with Files… and Folder… disabled", async () => {
        render(<SetCard />);

        fireEvent.click(dropArea(), { detail: 1, clientX: 120, clientY: 80 });

        const menu = await screen.findByRole("menu", { name: "Add to set" });
        const items = within(menu).getAllByRole("menuitem");
        expect(items.map((item) => item.textContent)).toEqual([
            "Files…Pick images or videos",
            "Folder…Add everything in a folder",
        ]);
        for (const item of items) {
            expect(item).toHaveAttribute("aria-disabled", "true");
        }
        // The open menu is modal, so the rest of the page is hidden from assistive technology meanwhile.
        expect(screen.getByRole("button", { name: /Drop files or folders here/, hidden: true })).toHaveAttribute(
            "aria-expanded",
            "true",
        );

        // jsdom lays nothing out, so the drop area's rect is at the origin and the anchor sits at the client point.
        const anchor = document.querySelector<HTMLElement>("[aria-haspopup='menu'] + span");
        expect(anchor).toHaveStyle({ left: "120px", top: "80px" });
    });

    it("opens at the drop area's centre from the keyboard", async () => {
        render(<SetCard />);
        dropArea().getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 210 });

        // A keyboard activation fires a click with `detail` 0.
        fireEvent.click(dropArea(), { detail: 0 });

        await screen.findByRole("menu", { name: "Add to set" });
        const anchor = document.querySelector<HTMLElement>("[aria-haspopup='menu'] + span");
        expect(anchor).toHaveStyle({ left: "200px", top: "105px" });
    });

    it("closes on Escape and returns focus to the drop area", async () => {
        render(<SetCard />);

        fireEvent.click(dropArea(), { detail: 1 });
        const menu = await screen.findByRole("menu", { name: "Add to set" });
        fireEvent.keyDown(menu, { key: "Escape" });

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(dropArea()).toHaveFocus();
        expect(dropArea()).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on a click outside and returns focus to the drop area", async () => {
        render(<SetCard />);

        fireEvent.click(dropArea(), { detail: 1 });
        await screen.findByRole("menu", { name: "Add to set" });
        // Radix dismisses on `pointerdown` outside the content.
        fireEvent.pointerDown(document.body);

        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        expect(dropArea()).toHaveFocus();
        expect(dropArea()).toHaveAttribute("aria-expanded", "false");
    });
});
