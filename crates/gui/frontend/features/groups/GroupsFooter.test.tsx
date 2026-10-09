import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { trashMedia } from "@/ipc/trash";
import { useScanStore } from "@/stores/scan";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { GroupsFooter } from "./GroupsFooter";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn(), restoreMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const mockedTrash = trashMedia as Mock;

const image = (name: string, size: number): GroupFile => ({
    path: `/p/${name}`,
    type: "image",
    width: 4032,
    height: 3024,
    size,
});

const status = () => screen.getByRole("status");

const mediaOf = ({ path, type, size }: GroupFile): MediaFile => ({
    path,
    name: path.slice(3),
    type,
    size,
    identity: `id-${path}`,
});

/** Renders the footer for `marked`, with the scan store holding them marked in one group of their own. */
const renderFooter = (marked: GroupFile[]) => {
    useScanStore.setState({
        files: marked.map(mediaOf),
        result: { groups: [{ files: marked }], skipped: [] },
        marks: new Set(marked.map((file) => file.path)),
    });
    render(<GroupsFooter marked={marked} />);
};

/** A promise the test settles when it chooses. */
const deferred = <T,>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

describe("GroupsFooter", () => {
    beforeEach(() => {
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        useScanStore.setState({ ...useScanStore.getInitialState(), status: "done" }, true);
        mockedTrash.mockReset();
    });

    it("counts the marked files and the space they free, with the button enabled", () => {
        renderFooter([image("IMG_2041 (1).jpg", 4_800_000), image("IMG_2041-edit.jpg", 1_100_000)]);

        expect(status()).toHaveTextContent(/^2 files marked for deletion · 5\.9 MB will be freed$/);
        const button = screen.getByRole("button", { name: "Move 2 to Trash…" });
        expect(button).toBeEnabled();
        expect(button).toHaveClass("bg-[#DC2626]");
    });

    it("reads 1 file for one", () => {
        renderFooter([image("DSC_0193.jpg", 3_200_000)]);

        expect(status()).toHaveTextContent(/^1 file marked for deletion · 3\.2 MB will be freed$/);
    });

    it("says nothing is marked yet, with Move 0 to Trash… disabled", () => {
        renderFooter([]);

        expect(status()).toHaveTextContent(
            /^Nothing marked yet\. Tick files, or let Auto-select pick the extras for you\.$/,
        );
        expect(screen.getByRole("button", { name: "Move 0 to Trash…" })).toBeDisabled();
    });

    it("follows the deletion settings", () => {
        useSettingsStore.setState({ deletionMode: "permanent", confirmDeletion: false });
        renderFooter([image("a.jpg", 1), image("b.jpg", 1), image("c.jpg", 1)]);

        expect(screen.getByRole("button", { name: "Delete 3 permanently" })).toBeInTheDocument();
    });

    describe("activating the button", () => {
        const marked = [image("a.jpg", 1), image("b.jpg", 1)];

        it("opens the confirmation with confirmation on, moving nothing and keeping the marks", () => {
            renderFooter(marked);

            fireEvent.click(screen.getByRole("button", { name: "Move 2 to Trash…" }));

            expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Move 2 files to Trash?");
            expect(mockedTrash).not.toHaveBeenCalled();
            expect(useScanStore.getState().marks.size).toBe(2);
        });

        it("removes at once with confirmation off, reading Moving… while it runs", async () => {
            useSettingsStore.setState({ confirmDeletion: false });
            const pending = deferred<unknown[]>();
            mockedTrash.mockReturnValue(pending.promise);
            renderFooter(marked);

            fireEvent.click(screen.getByRole("button", { name: "Move 2 to Trash" }));

            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Moving…" })).toBeDisabled();
            await act(async () => pending.resolve([{ status: "trashed" }, { status: "trashed" }]));
            expect(useScanStore.getState().gone.size).toBe(2);
        });

        it("reads Deleting… while a permanent deletion runs", () => {
            useSettingsStore.setState({ confirmDeletion: false, deletionMode: "permanent" });
            renderFooter(marked);
            act(() => useScanStore.setState({ deletion: { status: "removing", mode: "permanent", confirmed: false } }));

            expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
        });

        it("is disabled while restoring", () => {
            renderFooter(marked);
            act(() => useScanStore.setState({ deletion: { status: "restoring" } }));

            expect(screen.getByRole("button", { name: "Move 2 to Trash…" })).toBeDisabled();
        });
    });

    it("says nothing is marked for deletion once a file has been removed", () => {
        useScanStore.setState({ gone: new Map([["/p/x.jpg", "trash"]]) });
        render(<GroupsFooter marked={[]} />);

        expect(status()).toHaveTextContent(/^Nothing marked for deletion\.$/);
        expect(screen.getByRole("button", { name: "Move 0 to Trash…" })).toBeDisabled();
    });
});
