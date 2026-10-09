import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletionNotice, HIDE_AFTER, type NoticeView } from "./DeletionNotice";

const status = () => screen.getByRole("status");

const show = (notice: NoticeView | undefined, undoCount = 0, onDismiss = () => {}) =>
    render(
        <DeletionNotice
            {...(notice && { notice })}
            undoCount={undoCount}
            restoring={false}
            onUndo={() => {}}
            onDismiss={onDismiss}
        />,
    );

describe("DeletionNotice", () => {
    it("renders the status region with no notice", () => {
        show(undefined);

        expect(status()).toBeEmptyDOMElement();
    });

    it("hides Undo on a Trash action when nothing can be restored", () => {
        show({ action: "trash", done: [{ size: 1_000_000 }], failed: [] }, 0);

        expect(status()).toHaveTextContent(/^1 file moved to Trash · 1\.0 MB freed$/);
        expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    });

    it("offers Undo with the count it is given on a Trash action, never on a deletion", () => {
        const { unmount } = show({ action: "trash", done: [{ size: 1 }, { size: 1 }, { size: 1 }], failed: [] }, 2);
        expect(screen.getByRole("button", { name: "Undo moving 2 files to Trash" })).toBeInTheDocument();
        unmount();

        show({ action: "permanent", done: [{ size: 1 }], failed: [] }, 1);
        expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    });

    it("names each failure with its file and reason", () => {
        show({ action: "restore", done: [], failed: [{ key: "/media/a.jpg", name: "a.jpg", message: "gone" }] });

        expect(status()).toHaveTextContent(/^Couldn't restore a\.jpg: gone$/);
    });

    describe("hiding", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("doesn't hide a notice with failures after HIDE_AFTER", () => {
            const onDismiss = vi.fn();
            show(
                { action: "trash", done: [{ size: 1 }], failed: [{ key: "k", name: "a.jpg", message: "no Trash" }] },
                1,
                onDismiss,
            );

            act(() => vi.advanceTimersByTime(HIDE_AFTER * 10));

            expect(onDismiss).not.toHaveBeenCalled();
            expect(status()).toHaveTextContent("Couldn't move a.jpg: no Trash");
        });

        it("asks to dismiss a notice with no failure after HIDE_AFTER", () => {
            const onDismiss = vi.fn();
            show({ action: "permanent", done: [{ size: 1 }], failed: [] }, 0, onDismiss);

            act(() => vi.advanceTimersByTime(HIDE_AFTER - 1));
            expect(onDismiss).not.toHaveBeenCalled();

            act(() => vi.advanceTimersByTime(1));
            expect(onDismiss).toHaveBeenCalledOnce();
        });
    });
});
