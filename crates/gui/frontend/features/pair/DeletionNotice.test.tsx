import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { type Notice, usePairResultStore } from "@/stores/pairResult";
import { DeletionNotice, HIDE_AFTER } from "./DeletionNotice";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn() }));

const media = (name: string, size: number): MediaFile => ({
    path: `/media/${name}`,
    name,
    type: "image",
    size,
    identity: `id-${name}`,
});

const A = media("IMG_2041.jpg", 4_800_000);
const B = media("IMG_2041-edit.jpg", 1_100_000);

const status = () => screen.getByRole("status");
const show = (notice: Notice) => act(() => usePairResultStore.setState({ notice }));

describe("DeletionNotice", () => {
    beforeEach(() => {
        usePairResultStore.setState({ ...usePairResultStore.getInitialState(), files: { a: A, b: B } }, true);
    });

    it("keeps an empty status region with no notice", () => {
        render(<DeletionNotice />);

        expect(status()).toBeEmptyDOMElement();
    });

    it("reports one file moved with the space freed, a check icon and Dismiss, inside the status region", () => {
        const { container } = render(<DeletionNotice />);

        show({ moved: ["b"], failed: [] });

        expect(status()).toHaveTextContent(/^1 file moved to Trash · 1\.1 MB freed$/);
        expect(screen.getByText("1 file")).toHaveClass("font-semibold");
        expect(status()).toContainElement(screen.getByRole("button", { name: "Dismiss" }));
        expect(container.querySelector(".lucide-circle-check")).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector(".lucide-triangle-alert")).not.toBeInTheDocument();
    });

    it("reports two files moved", () => {
        render(<DeletionNotice />);

        show({ moved: ["a", "b"], failed: [] });

        expect(status()).toHaveTextContent("2 files moved to Trash · 5.9 MB freed");
    });

    it("reports a mixed result on two lines", () => {
        render(<DeletionNotice />);

        show({ moved: ["b"], failed: [{ slot: "a", message: "the folder is read-only" }] });

        const lines = [...status().querySelectorAll("p")].map((line) => line.textContent);
        expect(lines).toEqual([
            "1 file moved to Trash · 1.1 MB freed",
            "Couldn't move IMG_2041.jpg: the folder is read-only",
        ]);
    });

    it("shows the error icon and no moved line when nothing moved", () => {
        const { container } = render(<DeletionNotice />);

        show({ moved: [], failed: [{ slot: "b", message: "it has changed since it was opened" }] });

        expect(status()).toHaveTextContent(/^Couldn't move IMG_2041-edit\.jpg: it has changed since it was opened$/);
        expect(status()).not.toHaveTextContent("moved to Trash");
        expect(container.querySelector(".lucide-triangle-alert")).toBeInTheDocument();
        expect(container.querySelector(".lucide-circle-check")).not.toBeInTheDocument();
    });

    it("closes on Dismiss, keeping the file gone", () => {
        usePairResultStore.setState({ trashed: { a: false, b: true } });
        render(<DeletionNotice />);
        show({ moved: ["b"], failed: [] });

        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

        expect(status()).toBeEmptyDOMElement();
        expect(usePairResultStore.getState().notice).toBeUndefined();
        expect(usePairResultStore.getState().trashed.b).toBe(true);
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
            render(<DeletionNotice />);
            show({ moved: ["b"], failed: [] });

            wait(HIDE_AFTER - 1);
            expect(status()).toHaveTextContent("1 file moved to Trash");

            wait(1);
            expect(status()).toBeEmptyDOMElement();
            expect(usePairResultStore.getState().notice).toBeUndefined();
        });

        it.each([
            ["a failure", { moved: [], failed: [{ slot: "b" as const, message: "no Trash" }] }],
            ["a mixed result", { moved: ["b" as const], failed: [{ slot: "a" as const, message: "no Trash" }] }],
        ])("keeps %s until dismissed", (_, notice) => {
            render(<DeletionNotice />);
            show(notice);

            wait(60_000);

            expect(status()).toHaveTextContent("Couldn't move");
        });

        it("holds while the pointer is over it, then hides six seconds after it leaves", () => {
            render(<DeletionNotice />);
            show({ moved: ["b"], failed: [] });

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
            render(<DeletionNotice />);
            show({ moved: ["b"], failed: [] });
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
            render(<DeletionNotice />);
            show({ moved: ["b"], failed: [] });
            fireEvent.pointerEnter(box());
            fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

            show({ moved: ["a"], failed: [] });
            wait(HIDE_AFTER);

            expect(status()).toBeEmptyDOMElement();
        });
    });
});
