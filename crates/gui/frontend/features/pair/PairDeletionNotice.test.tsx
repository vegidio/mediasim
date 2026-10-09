import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { HIDE_AFTER } from "@/components/deletion/DeletionNotice";
import type { MediaFile } from "@/ipc/thumbs";
import { type RestoreOutcome, restoreMedia } from "@/ipc/trash";
import { type Notice, usePairResultStore } from "@/stores/pairResult";
import { PairDeletionNotice } from "./PairDeletionNotice";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), restoreMedia: vi.fn() }));

const media = (name: string, size: number): MediaFile => ({
    path: `/media/${name}`,
    name,
    type: "image",
    size,
    identity: `id-${name}`,
});

const A = media("IMG_2041.jpg", 4_800_000);
const B = media("IMG_2041-edit.jpg", 1_100_000);

const mockedRestore = restoreMedia as Mock;

const status = () => screen.getByRole("status");
const show = (notice: Notice) => act(() => usePairResultStore.setState({ notice }));

describe("PairDeletionNotice", () => {
    beforeEach(() => {
        usePairResultStore.setState({ ...usePairResultStore.getInitialState(), files: { a: A, b: B } }, true);
    });

    it("keeps an empty status region with no notice", () => {
        render(<PairDeletionNotice />);

        expect(status()).toBeEmptyDOMElement();
    });

    it("reports one file moved with the space freed, a check icon and Dismiss, inside the status region", () => {
        const { container } = render(<PairDeletionNotice />);

        show({ action: "trash", done: ["b"], failed: [] });

        expect(status()).toHaveTextContent(/^1 file moved to Trash · 1\.1 MB freed$/);
        expect(screen.getByText("1 file")).toHaveClass("font-semibold");
        expect(status()).toContainElement(screen.getByRole("button", { name: "Dismiss" }));
        expect(container.querySelector(".lucide-circle-check")).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector(".lucide-triangle-alert")).not.toBeInTheDocument();
    });

    it("reports two files moved", () => {
        render(<PairDeletionNotice />);

        show({ action: "trash", done: ["a", "b"], failed: [] });

        expect(status()).toHaveTextContent("2 files moved to Trash · 5.9 MB freed");
    });

    it("reports a mixed result on two lines", () => {
        render(<PairDeletionNotice />);

        show({ action: "trash", done: ["b"], failed: [{ key: "a", message: "the folder is read-only" }] });

        const lines = [...status().querySelectorAll("p")].map((line) => line.textContent);
        expect(lines).toEqual([
            "1 file moved to Trash · 1.1 MB freed",
            "Couldn't move IMG_2041.jpg: the folder is read-only",
        ]);
    });

    it("shows the error icon and no moved line when nothing moved", () => {
        const { container } = render(<PairDeletionNotice />);

        show({ action: "trash", done: [], failed: [{ key: "b", message: "it has changed since it was opened" }] });

        expect(status()).toHaveTextContent(/^Couldn't move IMG_2041-edit\.jpg: it has changed since it was opened$/);
        expect(status()).not.toHaveTextContent("moved to Trash");
        expect(container.querySelector(".lucide-triangle-alert")).toBeInTheDocument();
        expect(container.querySelector(".lucide-circle-check")).not.toBeInTheDocument();
    });

    it("closes on Dismiss, keeping the file gone", () => {
        usePairResultStore.setState({ gone: { b: "trash" } });
        render(<PairDeletionNotice />);
        show({ action: "trash", done: ["b"], failed: [] });

        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

        expect(status()).toBeEmptyDOMElement();
        expect(usePairResultStore.getState().notice).toBeUndefined();
        expect(usePairResultStore.getState().gone.b).toBe("trash");
    });

    describe("undo", () => {
        const restored = (identity: string): RestoreOutcome => ({ status: "restored", identity });
        const undo = () => screen.queryByRole("button", { name: /^Undo moving/ });

        beforeEach(() => {
            mockedRestore.mockReset();
        });

        it("offers Undo between the text and Dismiss, named with the count", () => {
            usePairResultStore.setState({ gone: { a: "trash", b: "trash" } });
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["a", "b"], failed: [] });

            const button = screen.getByRole("button", { name: "Undo moving 2 files to Trash" });
            expect(button).toHaveTextContent(/^Undo$/);
            expect(button.nextElementSibling).toBe(screen.getByRole("button", { name: "Dismiss" }));
            expect(status()).toHaveTextContent(/^2 files moved to Trash · 5\.9 MB freedUndo$/);
        });

        it("restores every file the move moved, and moves focus to Dismiss", async () => {
            usePairResultStore.setState({ gone: { a: "trash", b: "trash" } });
            mockedRestore.mockResolvedValue([restored(A.identity), restored(B.identity)]);
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["a", "b"], failed: [] });

            fireEvent.click(screen.getByRole("button", { name: "Undo moving 2 files to Trash" }));

            await waitFor(() => expect(status()).toHaveTextContent(/^2 files restored$/));
            expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([A.identity, B.identity]);
            await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss" })).toHaveFocus());
        });

        it("restores only the files the move moved that are still in the Trash", async () => {
            usePairResultStore.setState({ gone: { b: "trash" } });
            mockedRestore.mockResolvedValue([restored(B.identity)]);
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["a", "b"], failed: [] });

            fireEvent.click(screen.getByRole("button", { name: "Undo moving 1 file to Trash" }));

            await waitFor(() => expect(status()).toHaveTextContent("1 file restored"));
            expect(mockedRestore).toHaveBeenCalledExactlyOnceWith([B.identity]);
        });

        it("hides Undo once every file the move moved is back", () => {
            usePairResultStore.setState({ gone: {} });
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["a", "b"], failed: [] });

            expect(undo()).not.toBeInTheDocument();
        });

        it("disables Undo while restoring", () => {
            usePairResultStore.setState({ gone: { b: "trash" }, deletion: { status: "restoring" } });
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["b"], failed: [] });

            expect(undo()).toBeDisabled();
        });

        it("offers no Undo for a move where nothing moved", () => {
            usePairResultStore.setState({ gone: {} });
            render(<PairDeletionNotice />);
            show({ action: "trash", done: [], failed: [{ key: "b", message: "no Trash" }] });

            expect(undo()).not.toBeInTheDocument();
        });
    });

    describe("delete", () => {
        it("reports one file deleted with the space freed, Dismiss and no Undo", () => {
            usePairResultStore.setState({ gone: { b: "permanent" } });
            const { container } = render(<PairDeletionNotice />);

            show({ action: "permanent", done: ["b"], failed: [] });

            expect(status()).toHaveTextContent(/^1 file deleted · 1\.1 MB freed$/);
            expect(screen.getByText("1 file")).toHaveClass("font-semibold");
            expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
            expect(container.querySelector(".lucide-circle-check")).toBeInTheDocument();
        });

        it("reports a file that couldn't be deleted, with the reason and the error icon", () => {
            const { container } = render(<PairDeletionNotice />);

            show({
                action: "permanent",
                done: [],
                failed: [{ key: "b", message: "Permission denied (os error 13)" }],
            });

            expect(status()).toHaveTextContent(
                /^Couldn't delete IMG_2041-edit\.jpg: Permission denied \(os error 13\)$/,
            );
            expect(container.querySelector(".lucide-triangle-alert")).toBeInTheDocument();
        });

        it("offers Undo only for the trashed file of a mixed pair", () => {
            usePairResultStore.setState({ gone: { a: "trash", b: "permanent" } });
            render(<PairDeletionNotice />);

            show({ action: "trash", done: ["a", "b"], failed: [] });

            expect(screen.getByRole("button", { name: "Undo moving 1 file to Trash" })).toBeInTheDocument();
        });
    });

    describe("restore", () => {
        it("reports one file restored with a check icon, Dismiss and no Undo", () => {
            usePairResultStore.setState({ gone: { a: "trash" } });
            const { container } = render(<PairDeletionNotice />);

            show({ action: "restore", done: ["b"], failed: [] });

            expect(status()).toHaveTextContent(/^1 file restored$/);
            expect(screen.getByText("1 file")).toHaveClass("font-semibold");
            expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
            expect(container.querySelector(".lucide-circle-check")).toBeInTheDocument();
        });

        it("reports a mixed restore on two lines", () => {
            render(<PairDeletionNotice />);

            show({
                action: "restore",
                done: ["b"],
                failed: [{ key: "a", message: "a file with its name is already in its folder" }],
            });

            const lines = [...status().querySelectorAll("p")].map((line) => line.textContent);
            expect(lines).toEqual([
                "1 file restored",
                "Couldn't restore IMG_2041.jpg: a file with its name is already in its folder",
            ]);
        });

        it("shows the error icon and no restored line when nothing was restored", () => {
            const { container } = render(<PairDeletionNotice />);

            show({ action: "restore", done: [], failed: [{ key: "b", message: "it is no longer in the Trash" }] });

            expect(status()).toHaveTextContent(/^Couldn't restore IMG_2041-edit\.jpg: it is no longer in the Trash$/);
            expect(container.querySelector(".lucide-triangle-alert")).toBeInTheDocument();
            expect(container.querySelector(".lucide-circle-check")).not.toBeInTheDocument();
        });
    });

    describe("hiding", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
        const box = () => screen.getByRole("button", { name: "Dismiss" }).parentElement as HTMLElement;

        it("hides a notice of files all moved after six seconds, keeping the file gone", () => {
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["b"], failed: [] });

            wait(HIDE_AFTER - 1);
            expect(status()).toHaveTextContent("1 file moved to Trash");

            wait(1);
            expect(status()).toBeEmptyDOMElement();
            expect(usePairResultStore.getState().notice).toBeUndefined();
        });

        it.each([
            ["a failure", { action: "trash" as const, done: [], failed: [{ key: "b" as const, message: "no Trash" }] }],
            [
                "a mixed result",
                {
                    action: "trash" as const,
                    done: ["b" as const],
                    failed: [{ key: "a" as const, message: "no Trash" }],
                },
            ],
        ])("keeps %s until dismissed", (_, notice) => {
            render(<PairDeletionNotice />);
            show(notice);

            wait(60_000);

            expect(status()).toHaveTextContent("Couldn't move");
        });

        it("hides a notice of files all restored after six seconds", () => {
            render(<PairDeletionNotice />);
            show({ action: "restore", done: ["b"], failed: [] });

            wait(HIDE_AFTER - 1);
            expect(status()).toHaveTextContent("1 file restored");

            wait(1);
            expect(status()).toBeEmptyDOMElement();
        });

        it("keeps a failed restore until dismissed", () => {
            render(<PairDeletionNotice />);
            show({ action: "restore", done: [], failed: [{ key: "b", message: "it is no longer in the Trash" }] });

            wait(60_000);

            expect(status()).toHaveTextContent("Couldn't restore");
        });

        it("holds while the pointer is over it, then hides six seconds after it leaves", () => {
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["b"], failed: [] });

            fireEvent.pointerEnter(box());
            wait(60_000);
            expect(status()).toHaveTextContent("1 file moved to Trash");

            fireEvent.pointerLeave(box());
            wait(HIDE_AFTER);
            expect(status()).toBeEmptyDOMElement();
        });

        it("holds while keyboard focus is in it, but not for a click's focus", () => {
            let keyboard = true;
            const original = Element.prototype.matches;
            const matches = vi.spyOn(Element.prototype, "matches").mockImplementation(function (
                this: Element,
                selector: string,
            ) {
                return selector === ":focus-visible" ? keyboard : original.call(this, selector);
            });
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["b"], failed: [] });
            const dismiss = screen.getByRole("button", { name: "Dismiss" });

            act(() => dismiss.focus());
            wait(60_000);
            expect(status()).toHaveTextContent("1 file moved to Trash");

            act(() => dismiss.blur());
            keyboard = false;
            act(() => dismiss.focus());
            wait(HIDE_AFTER);
            expect(status()).toBeEmptyDOMElement();
            matches.mockRestore();
        });

        it("times a new notice afresh after one dismissed under the pointer", () => {
            render(<PairDeletionNotice />);
            show({ action: "trash", done: ["b"], failed: [] });
            fireEvent.pointerEnter(box());
            fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

            show({ action: "trash", done: ["a"], failed: [] });
            wait(HIDE_AFTER);

            expect(status()).toBeEmptyDOMElement();
        });
    });
});
