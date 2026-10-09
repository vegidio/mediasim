import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { cancelComparison, comparePair, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { deleteMedia, trashMedia } from "@/ipc/trash";
import { usePairResultStore } from "@/stores/pairResult";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";
import { PairDeletionFooter } from "./PairDeletionFooter";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn() }));
vi.mock("@/ipc/thumbs", () => ({ renditionUrl: (identity: string) => `thumb://localhost/${identity}` }));

const media = (name: string, size: number): MediaFile => ({
    path: `/media/${name}`,
    name,
    type: "video",
    size,
    identity: `id-${name}`,
});

const A = media("a.mp4", 312_000_000);
const B = media("b.mp4", 48_000_000);

const status = () => screen.getByRole("status");
const move = () => screen.getByRole("button", { name: /^Move \d to Trash…$/ });
const toggle = (slot: "a" | "b") => act(() => usePairResultStore.getState().toggleMark(slot));

describe("PairDeletionFooter", () => {
    beforeEach(() => {
        usePairResultStore.setState({ ...usePairResultStore.getInitialState(), files: { a: A, b: B } }, true);
        useSettingsStore.setState(SETTINGS_DEFAULTS);
        vi.clearAllMocks();
    });

    it("says nothing is marked, with Move 0 to Trash… disabled", () => {
        render(<PairDeletionFooter />);

        expect(status()).toHaveTextContent("Nothing marked yet. Mark the file you don't need.");
        expect(move()).toHaveTextContent("Move 0 to Trash…");
        expect(move()).toBeDisabled();
    });

    it("counts one marked file and the space it frees, with the button enabled", () => {
        render(<PairDeletionFooter />);

        toggle("b");

        expect(status()).toHaveTextContent("1 file marked for deletion · 48.0 MB will be freed");
        expect(move()).toHaveTextContent("Move 1 to Trash…");
        expect(move()).toBeEnabled();
        expect(move()).toHaveClass("bg-danger");
    });

    it("counts both marked files", () => {
        render(<PairDeletionFooter />);

        toggle("a");
        toggle("b");

        expect(status()).toHaveTextContent("2 files marked for deletion · 360.0 MB will be freed");
        expect(move()).toHaveTextContent("Move 2 to Trash…");
    });

    it("goes back to the empty text after an undo", () => {
        render(<PairDeletionFooter />);

        toggle("b");
        toggle("b");

        expect(status()).toHaveTextContent("Nothing marked yet. Mark the file you don't need.");
        expect(move()).toBeDisabled();
    });

    it("opens the confirmation when the enabled button is activated, moving nothing", () => {
        render(<PairDeletionFooter />);
        toggle("b");

        fireEvent.click(move());

        expect(screen.getByRole("alertdialog", { name: "Move 1 file to Trash?" })).toBeInTheDocument();
        expect(usePairResultStore.getState().deletion).toEqual({ status: "confirming", mode: "trash" });
        expect(usePairResultStore.getState().marked).toEqual({ a: false, b: true });
        expect(usePairResultStore.getState().files).toEqual({ a: A, b: B });
        for (const call of [probeMedia, comparePair, cancelComparison, trashMedia]) {
            expect(call as Mock).not.toHaveBeenCalled();
        }
    });

    it("says nothing is marked for deletion once a file is moved, with Move 0 to Trash… disabled", () => {
        usePairResultStore.setState({ gone: { b: "trash" } });

        render(<PairDeletionFooter />);

        expect(status()).toHaveTextContent(/^Nothing marked for deletion\.$/);
        expect(move()).toHaveTextContent("Move 0 to Trash…");
        expect(move()).toBeDisabled();
    });

    it("says nothing is marked yet once the moved file is restored", () => {
        usePairResultStore.setState({ gone: { b: "trash" } });
        render(<PairDeletionFooter />);

        act(() => usePairResultStore.setState({ gone: {} }));

        expect(status()).toHaveTextContent(/^Nothing marked yet\. Mark the file you don't need\.$/);
    });

    it("says nothing is marked for deletion once a file is deleted", () => {
        usePairResultStore.setState({ gone: { b: "permanent" } });

        render(<PairDeletionFooter />);

        expect(status()).toHaveTextContent(/^Nothing marked for deletion\.$/);
    });

    it("counts only the file still there once the other is moved", () => {
        usePairResultStore.setState({ gone: { b: "trash" } });
        render(<PairDeletionFooter />);

        toggle("a");

        expect(status()).toHaveTextContent("1 file marked for deletion · 312.0 MB will be freed");
    });

    it("keeps its text inside the status region and the badge's icon hidden", () => {
        const { container } = render(<PairDeletionFooter />);
        toggle("a");

        expect(status()).toHaveTextContent("1 file");
        expect(status()).toContainElement(screen.getByText("1 file"));
        expect(container.querySelector(".lucide-trash-2")).toHaveAttribute("aria-hidden", "true");
    });

    describe("following the settings", () => {
        const button = () => screen.getByRole("button", { name: /^(Move|Delete|Moving|Deleting)/ });

        it.each([
            ["trash", true, "Move 1 to Trash…"],
            ["trash", false, "Move 1 to Trash"],
            ["permanent", true, "Delete 1 permanently…"],
            ["permanent", false, "Delete 1 permanently"],
        ] as const)("reads, in %s mode with confirm %s, %s", (deletionMode, confirmDeletion, label) => {
            useSettingsStore.setState({ deletionMode, confirmDeletion });
            render(<PairDeletionFooter />);

            toggle("b");

            expect(button()).toHaveTextContent(new RegExp(`^${label}$`));
        });

        it.each([
            ["trash", trashMedia, { status: "trashed" }, "Moving…"],
            ["permanent", deleteMedia, { status: "deleted" }, "Deleting…"],
        ] as const)(
            "with confirm off in %s mode, removes at once with no dialog, then focuses Dismiss",
            async (deletionMode, call, outcome, running) => {
                useSettingsStore.setState({ deletionMode, confirmDeletion: false });
                let resolve: (value: unknown[]) => void = () => {};
                (call as Mock).mockReturnValue(new Promise((res) => (resolve = res)));
                const dismiss = document.createElement("button");
                dismiss.id = "deletion-notice-dismiss";
                document.body.append(dismiss);
                render(<PairDeletionFooter />);
                toggle("b");

                fireEvent.click(button());

                expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
                expect(call as Mock).toHaveBeenCalledExactlyOnceWith([B.identity]);
                expect(button()).toHaveTextContent(running);
                expect(button()).toBeDisabled();

                await act(async () => resolve([outcome]));

                expect(status()).toHaveTextContent(/^Nothing marked for deletion\.$/);
                await waitFor(() => expect(dismiss).toHaveFocus());
                dismiss.remove();
            },
        );

        it("with confirm off, starts nothing while a restore runs, and keeps focus on the button", async () => {
            useSettingsStore.setState({ deletionMode: "permanent", confirmDeletion: false });
            const dismiss = document.createElement("button");
            dismiss.id = "deletion-notice-dismiss";
            document.body.append(dismiss);
            render(<PairDeletionFooter />);
            toggle("b");
            act(() => usePairResultStore.setState({ deletion: { status: "restoring" } }));
            act(() => button().focus());

            fireEvent.click(button());

            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
            // Long enough for a focus sent on the next frame to land.
            await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
            expect(deleteMedia).not.toHaveBeenCalled();
            expect(button()).toHaveFocus();
            dismiss.remove();
        });
    });
});
