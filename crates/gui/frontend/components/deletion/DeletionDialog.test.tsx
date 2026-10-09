import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { DeletionDialog } from "./DeletionDialog";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const media = (name: string, size: number): MediaFile => ({
    path: `/media/${name}`,
    name,
    type: "image",
    size,
    identity: `id-${name}`,
});

const C = media("beach.png", 2_000_000);
const D = media("beach-copy.png", 500_000);

const dialog = () => screen.getByRole("alertdialog");
const rows = () =>
    within(screen.getByRole("list", { name: "Files to delete" }))
        .getAllByRole("listitem")
        .map((row) => row.textContent);

type Props = Omit<ComponentProps<typeof DeletionDialog>, "children">;

const PROPS: Props = {
    open: true,
    mode: "trash",
    files: [C, D],
    removing: false,
    onOpenChange: () => {},
    onConfirm: () => {},
};

/** Renders the dialog with `props` over {@link PROPS}, and a way to render it again with others. */
const show = (props: Partial<Props> = {}) => {
    const view = (next: Partial<Props>) => (
        <DeletionDialog {...PROPS} {...next}>
            <button type="button">Remove…</button>
        </DeletionDialog>
    );
    const { rerender } = render(view(props));

    return (next: Partial<Props>) => rerender(view(next));
};

describe("DeletionDialog", () => {
    it("lists the files it is given, with the count and the total", () => {
        show();

        expect(dialog()).toHaveAccessibleName("Move 2 files to Trash?");
        expect(rows()).toEqual(["beach.png2.0 MB", "beach-copy.png500.0 kB"]);
        expect(dialog()).toHaveTextContent("2 filesTotal 2.5 MB");
    });

    it.each([
        ["trash", false],
        ["permanent", true],
    ] as const)("in %s mode, shows the permanent warning: %s", (mode, warned) => {
        show({ mode });

        if (warned) expect(dialog()).toHaveTextContent("This cannot be undone. The files won't go to the Trash.");
        else expect(dialog()).not.toHaveTextContent("This cannot be undone.");
    });

    it("keeps its list and title when the files empty and the mode changes as it removes", () => {
        const update = show();

        update({ removing: true, files: [], mode: "permanent" });

        expect(dialog()).toHaveAccessibleName("Move 2 files to Trash?");
        expect(rows()).toEqual(["beach.png2.0 MB", "beach-copy.png500.0 kB"]);
        expect(within(dialog()).getByRole("button", { name: "Moving…" })).toBeDisabled();
    });

    it("ignores Escape while removing", () => {
        const onOpenChange = vi.fn();
        show({ removing: true, onOpenChange });

        fireEvent.keyDown(dialog(), { key: "Escape" });

        expect(dialog()).toBeInTheDocument();
        expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("asks to close on Escape while confirming, and confirms on the action", () => {
        const onOpenChange = vi.fn();
        const onConfirm = vi.fn();
        show({ onOpenChange, onConfirm });

        fireEvent.click(within(dialog()).getByRole("button", { name: "Move to Trash" }));
        expect(onConfirm).toHaveBeenCalledOnce();
        expect(onOpenChange).not.toHaveBeenCalled();

        fireEvent.keyDown(dialog(), { key: "Escape" });
        expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    });
});
