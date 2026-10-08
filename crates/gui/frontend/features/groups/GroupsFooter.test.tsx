import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { GroupsFooter } from "./GroupsFooter";

const image = (name: string, size: number): GroupFile => ({
    path: `/p/${name}`,
    type: "image",
    width: 4032,
    height: 3024,
    size,
});

const status = () => screen.getByRole("status");

describe("GroupsFooter", () => {
    beforeEach(() => {
        useSettingsStore.setState(SETTINGS_DEFAULTS);
    });

    it("counts the marked files and the space they free, with the button enabled", () => {
        render(<GroupsFooter marked={[image("IMG_2041 (1).jpg", 4_800_000), image("IMG_2041-edit.jpg", 1_100_000)]} />);

        expect(status()).toHaveTextContent(/^2 files marked for deletion · 5\.9 MB will be freed$/);
        const button = screen.getByRole("button", { name: "Move 2 to Trash…" });
        expect(button).toBeEnabled();
        expect(button).toHaveClass("bg-[#DC2626]");
    });

    it("reads 1 file for one", () => {
        render(<GroupsFooter marked={[image("DSC_0193.jpg", 3_200_000)]} />);

        expect(status()).toHaveTextContent(/^1 file marked for deletion · 3\.2 MB will be freed$/);
    });

    it("says nothing is marked yet, with Move 0 to Trash… disabled", () => {
        render(<GroupsFooter marked={[]} />);

        expect(status()).toHaveTextContent(
            /^Nothing marked yet\. Tick files, or let Auto-select pick the extras for you\.$/,
        );
        expect(screen.getByRole("button", { name: "Move 0 to Trash…" })).toBeDisabled();
    });

    it("follows the deletion settings", () => {
        useSettingsStore.setState({ deletionMode: "permanent", confirmDeletion: false });
        render(<GroupsFooter marked={[image("a.jpg", 1), image("b.jpg", 1), image("c.jpg", 1)]} />);

        expect(screen.getByRole("button", { name: "Delete 3 permanently" })).toBeInTheDocument();
    });

    it("does nothing when the button is activated", () => {
        const marked = [image("a.jpg", 1), image("b.jpg", 1)];
        render(<GroupsFooter marked={marked} />);

        fireEvent.click(screen.getByRole("button", { name: "Move 2 to Trash…" }));

        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(status()).toHaveTextContent(/^2 files marked for deletion/);
    });
});
