import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { type DeleteOutcome, deleteMedia, type TrashOutcome, trashMedia } from "@/ipc/trash";
import { usePairResultStore } from "@/stores/pairResult";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import packageJson from "../../../package.json";
import { DeletionFooter } from "./DeletionFooter";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const mockedTrash = trashMedia as Mock;
const mockedDelete = deleteMedia as Mock;

const media = (name: string, size: number): MediaFile => ({
    path: `/media/${name}`,
    name,
    type: "image",
    size,
    identity: `id-${name}`,
});

const A = media("IMG_2041.jpg", 4_800_000);
const B = media("IMG_2041-edit.jpg", 1_100_000);

const trigger = () => screen.getByRole("button", { name: /^(Move \d to Trash|Delete \d permanently)…$/ });
const dialog = () => screen.getByRole("alertdialog");
const queryDialog = () => screen.queryByRole("alertdialog");
const primary = () => within(dialog()).getByRole("button", { name: /Move to Trash|Moving…/ });
const cancel = () => within(dialog()).getByRole("button", { name: "Cancel" });

/** Marks `slots` and opens the dialog from the footer's button. */
const open = (...slots: ("a" | "b")[]) => {
    render(<DeletionFooter />);
    for (const slot of slots) act(() => usePairResultStore.getState().toggleMark(slot));
    fireEvent.click(trigger());
};

/** A promise the test settles when it chooses. */
const deferred = <T,>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

describe("ConfirmDeletionDialog", () => {
    beforeEach(() => {
        usePairResultStore.setState({ ...usePairResultStore.getInitialState(), files: { a: A, b: B } }, true);
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        vi.clearAllMocks();
    });

    it("asks about one file, listing its thumbnail, name and size, the count and the total", () => {
        open("b");

        expect(dialog()).toHaveAccessibleName("Move 1 file to Trash?");
        expect(dialog()).toHaveAccessibleDescription("You can restore it from the Trash until it is emptied.");
        const rows = within(screen.getByRole("list", { name: "Files to delete" })).getAllByRole("listitem");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent("IMG_2041-edit.jpg1.1 MB");
        expect(rows[0]?.querySelector("img")).toHaveAttribute("src", "thumb://localhost/id-IMG_2041-edit.jpg?size=96");
        expect(dialog()).toHaveTextContent("1 fileTotal 1.1 MB");
        expect(dialog()).toHaveTextContent("Settings: move to Trash");
        expect(dialog()).not.toHaveTextContent("This cannot be undone.");
        expect(cancel()).toBeInTheDocument();
        expect(primary()).toHaveTextContent("Move to Trash");
        // Red, overriding the button's accent rather than sitting beside it.
        expect(primary()).toHaveClass("bg-[#DC2626]");
        expect(primary()).not.toHaveClass("bg-primary");
    });

    it("asks about two files, listing A then B", () => {
        open("b", "a");

        expect(dialog()).toHaveAccessibleName("Move 2 files to Trash?");
        expect(dialog()).toHaveAccessibleDescription("You can restore them from the Trash until it is emptied.");
        const rows = within(screen.getByRole("list", { name: "Files to delete" })).getAllByRole("listitem");
        expect(rows.map((row) => row.textContent)).toEqual(["IMG_2041.jpg4.8 MB", "IMG_2041-edit.jpg1.1 MB"]);
        expect(dialog()).toHaveTextContent("2 filesTotal 5.9 MB");
    });

    it("shows the kind icon when a thumbnail can't be produced", () => {
        open("b");
        const row = within(dialog()).getByRole("listitem");

        fireEvent.error(row.querySelector("img") as HTMLImageElement);

        expect(row.querySelector("img")).not.toBeInTheDocument();
        expect(row.querySelector(".lucide-image")).toBeInTheDocument();
    });

    it("moves focus inside the dialog when it opens", () => {
        open("b");

        expect(dialog()).toContainElement(document.activeElement as HTMLElement);
    });

    it.each([
        ["Cancel", () => fireEvent.click(cancel())],
        ["Escape", () => fireEvent.keyDown(dialog(), { key: "Escape" })],
    ])("closes on %s, moving nothing and returning focus to the footer's button", async (_, close) => {
        open("b");

        close();

        expect(queryDialog()).not.toBeInTheDocument();
        expect(mockedTrash).not.toHaveBeenCalled();
        expect(usePairResultStore.getState().marked).toEqual({ a: false, b: true });
        // Radix returns focus once the dialog has unmounted, on a timer.
        await waitFor(() => expect(trigger()).toHaveFocus());
    });

    it("stays open on a press outside", () => {
        open("b");

        fireEvent.pointerDown(document.body);

        expect(dialog()).toBeInTheDocument();
    });

    it("reads Moving… with both buttons disabled while moving, and ignores Escape", async () => {
        const pending = deferred<TrashOutcome[]>();
        mockedTrash.mockReturnValue(pending.promise);
        open("b");

        fireEvent.click(primary());

        expect(primary()).toHaveTextContent("Moving…");
        expect(primary()).toBeDisabled();
        expect(cancel()).toBeDisabled();
        fireEvent.keyDown(dialog(), { key: "Escape" });
        expect(dialog()).toBeInTheDocument();
        expect(mockedTrash).toHaveBeenCalledExactlyOnceWith([B.identity]);

        await act(async () => pending.resolve([{ status: "trashed" }]));

        expect(queryDialog()).not.toBeInTheDocument();
    });

    describe("permanent mode", () => {
        const deletePrimary = () => within(dialog()).getByRole("button", { name: /Delete permanently|Deleting…/ });

        beforeEach(() => {
            useSettingsStore.setState({ deletionMode: "permanent" });
        });

        it("asks about one file, warning it won't go to the Trash", () => {
            open("b");

            expect(dialog()).toHaveAccessibleName("Delete 1 file permanently?");
            expect(dialog()).toHaveAccessibleDescription("This file will be removed from your disk.");
            expect(dialog()).toHaveTextContent("This cannot be undone. The file won't go to the Trash.");
            expect(dialog()).toHaveTextContent("Settings: delete permanently");
            expect(deletePrimary()).toHaveTextContent(/^Delete permanently$/);
            expect(within(dialog()).queryByRole("button", { name: "Move to Trash" })).not.toBeInTheDocument();
        });

        it("asks about two files", () => {
            open("a", "b");

            expect(dialog()).toHaveAccessibleName("Delete 2 files permanently?");
            expect(dialog()).toHaveAccessibleDescription("These files will be removed from your disk.");
            expect(dialog()).toHaveTextContent("This cannot be undone. The files won't go to the Trash.");
        });

        it("reads Deleting… with both buttons disabled while deleting, and ignores Escape", async () => {
            let resolve: (value: DeleteOutcome[]) => void = () => {};
            mockedDelete.mockReturnValue(new Promise((res) => (resolve = res)));
            open("b");

            fireEvent.click(deletePrimary());

            expect(deletePrimary()).toHaveTextContent("Deleting…");
            expect(deletePrimary()).toBeDisabled();
            expect(cancel()).toBeDisabled();
            fireEvent.keyDown(dialog(), { key: "Escape" });
            expect(dialog()).toBeInTheDocument();
            expect(mockedDelete).toHaveBeenCalledExactlyOnceWith([B.identity]);
            expect(mockedTrash).not.toHaveBeenCalled();

            await act(async () => resolve([{ status: "deleted" }]));

            expect(queryDialog()).not.toBeInTheDocument();
        });

        it("deletes nothing on Cancel", () => {
            open("b");

            fireEvent.click(cancel());

            expect(queryDialog()).not.toBeInTheDocument();
            expect(mockedDelete).not.toHaveBeenCalled();
            expect(usePairResultStore.getState().marked).toEqual({ a: false, b: true });
        });

        it("keeps the mode it opened in if Settings changes while it is open", () => {
            open("b");

            act(() => useSettingsStore.setState({ deletionMode: "trash" }));

            expect(dialog()).toHaveAccessibleName("Delete 1 file permanently?");
        });
    });

    it("adds no npm package", () => {
        expect(Object.keys(packageJson.dependencies).sort()).toEqual([
            "@fontsource-variable/geist",
            "@fontsource-variable/geist-mono",
            "@tanstack/react-virtual",
            "@tauri-apps/api",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/plugin-os",
            "class-variance-authority",
            "cn",
            "lucide-react",
            "radix-ui",
            "react",
            "react-dom",
            "shadcn",
            "tw-animate-css",
            "zustand",
        ]);
    });
});
