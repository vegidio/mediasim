import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { cancelComparison, comparePair, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { trashMedia } from "@/ipc/trash";
import { usePairResultStore } from "@/stores/pairResult";
import { DeletionFooter } from "./DeletionFooter";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn() }));
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

describe("DeletionFooter", () => {
    beforeEach(() => {
        usePairResultStore.setState({ ...usePairResultStore.getInitialState(), files: { a: A, b: B } }, true);
        vi.clearAllMocks();
    });

    it("says nothing is marked, with Move 0 to Trash… disabled", () => {
        render(<DeletionFooter />);

        expect(status()).toHaveTextContent("Nothing marked yet. Mark the file you don't need.");
        expect(move()).toHaveTextContent("Move 0 to Trash…");
        expect(move()).toBeDisabled();
    });

    it("counts one marked file and the space it frees, with the button enabled", () => {
        render(<DeletionFooter />);

        toggle("b");

        expect(status()).toHaveTextContent("1 file marked for deletion · 48.0 MB will be freed");
        expect(move()).toHaveTextContent("Move 1 to Trash…");
        expect(move()).toBeEnabled();
        expect(move()).toHaveClass("bg-[#DC2626]");
    });

    it("counts both marked files", () => {
        render(<DeletionFooter />);

        toggle("a");
        toggle("b");

        expect(status()).toHaveTextContent("2 files marked for deletion · 360.0 MB will be freed");
        expect(move()).toHaveTextContent("Move 2 to Trash…");
    });

    it("goes back to the empty text after an undo", () => {
        render(<DeletionFooter />);

        toggle("b");
        toggle("b");

        expect(status()).toHaveTextContent("Nothing marked yet. Mark the file you don't need.");
        expect(move()).toBeDisabled();
    });

    it("opens the confirmation when the enabled button is activated, moving nothing", () => {
        render(<DeletionFooter />);
        toggle("b");

        fireEvent.click(move());

        expect(screen.getByRole("alertdialog", { name: "Move 1 file to Trash?" })).toBeInTheDocument();
        expect(usePairResultStore.getState().deletion).toEqual({ status: "confirming" });
        expect(usePairResultStore.getState().marked).toEqual({ a: false, b: true });
        expect(usePairResultStore.getState().files).toEqual({ a: A, b: B });
        for (const call of [probeMedia, comparePair, cancelComparison, trashMedia]) {
            expect(call as Mock).not.toHaveBeenCalled();
        }
    });

    it("says nothing is marked for deletion once a file is moved, with Move 0 to Trash… disabled", () => {
        usePairResultStore.setState({ trashed: { a: false, b: true } });

        render(<DeletionFooter />);

        expect(status()).toHaveTextContent(/^Nothing marked for deletion\.$/);
        expect(move()).toHaveTextContent("Move 0 to Trash…");
        expect(move()).toBeDisabled();
    });

    it("counts only the file still there once the other is moved", () => {
        usePairResultStore.setState({ trashed: { a: false, b: true } });
        render(<DeletionFooter />);

        toggle("a");

        expect(status()).toHaveTextContent("1 file marked for deletion · 312.0 MB will be freed");
    });

    it("keeps its text inside the status region and the badge's icon hidden", () => {
        const { container } = render(<DeletionFooter />);
        toggle("a");

        expect(status()).toHaveTextContent("1 file");
        expect(status()).toContainElement(screen.getByText("1 file"));
        expect(container.querySelector(".lucide-trash-2")).toHaveAttribute("aria-hidden", "true");
    });
});
