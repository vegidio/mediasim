import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import type { GroupFile, ScanGroup } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { useScanStore } from "@/stores/scan";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { GroupsDeletionDialog } from "./GroupsDeletionDialog";
import { markedFiles, pickBest, visibleGroups } from "./marks";
import { DEFAULT_RULES } from "./rules";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn(), restoreMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const file = (name: string, size: number): MediaFile => ({
    path: `/p/${name}`,
    name,
    type: "image",
    size,
    identity: `id-${name}`,
});

const FILES = [
    file("IMG_2041.jpg", 4_800_000),
    file("IMG_2041 (1).jpg", 4_800_000),
    file("IMG_2041-edit.jpg", 1_100_000),
    file("DSC_0193.HEIC", 4_100_000),
    file("DSC_0193.jpg", 3_200_000),
];

const grouped = ({ path, size }: MediaFile): GroupFile => ({ path, type: "image", width: 1, height: 1, size });

const GROUPS: ScanGroup[] = [{ files: FILES.slice(0, 3).map(grouped) }, { files: FILES.slice(3).map(grouped) }];

/** Renders the dialog around its trigger, for the files marked, as the footer does. */
const renderDialog = () => {
    const { result, gone, marks } = useScanStore.getState();
    const marked = markedFiles(pickBest(visibleGroups(result?.groups ?? [], gone), DEFAULT_RULES), marks);
    render(
        <GroupsDeletionDialog marked={marked}>
            <Button>Move {marked.length} to Trash…</Button>
        </GroupsDeletionDialog>,
    );
};

const dialog = () => screen.getByRole("alertdialog");

describe("GroupsDeletionDialog", () => {
    beforeEach(() => {
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useScanStore.setState(
            {
                ...useScanStore.getInitialState(),
                status: "done",
                files: FILES,
                result: { groups: GROUPS, skipped: [] },
                // Marked out of order, to show the dialog lists them as the groups do.
                marks: new Set(["/p/DSC_0193.jpg", "/p/IMG_2041-edit.jpg", "/p/IMG_2041 (1).jpg"]),
            },
            true,
        );
    });

    it("lists the marked files in the groups' order, with the count and the total", () => {
        renderDialog();

        fireEvent.click(screen.getByRole("button", { name: "Move 3 to Trash…" }));

        expect(dialog()).toHaveAccessibleName("Move 3 files to Trash?");
        const rows = within(screen.getByRole("list", { name: "Files to delete" })).getAllByRole("listitem");
        expect(rows.map((row) => row.textContent)).toEqual([
            "IMG_2041 (1).jpg4.8 MB",
            "IMG_2041-edit.jpg1.1 MB",
            "DSC_0193.jpg3.2 MB",
        ]);
        expect(dialog()).toHaveTextContent("3 filesTotal 9.1 MB");
    });

    it("follows the mode asked in", () => {
        useSettingsStore.setState({ deletionMode: "permanent" });
        renderDialog();

        fireEvent.click(screen.getByRole("button", { name: "Move 3 to Trash…" }));

        expect(dialog()).toHaveAccessibleName("Delete 3 files permanently?");
    });

    it("closes on Cancel, back to idle with the marks kept", () => {
        renderDialog();
        fireEvent.click(screen.getByRole("button", { name: "Move 3 to Trash…" }));

        fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(useScanStore.getState().deletion).toEqual({ status: "idle" });
        expect(useScanStore.getState().marks.size).toBe(3);
    });
});
