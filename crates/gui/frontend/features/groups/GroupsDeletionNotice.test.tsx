import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { HIDE_AFTER } from "@/components/deletion/DeletionNotice";
import type { MediaFile } from "@/ipc/thumbs";
import { restoreMedia } from "@/ipc/trash";
import { type ScanNotice, useScanStore } from "@/stores/scan";
import { GroupsDeletionNotice } from "./GroupsDeletionNotice";

vi.mock("@/ipc/scan", () => ({ startScan: vi.fn(), cancelScan: vi.fn() }));
vi.mock("@/ipc/trash", () => ({ trashMedia: vi.fn(), deleteMedia: vi.fn(), restoreMedia: vi.fn() }));

const mockedRestore = restoreMedia as Mock;

/** 11 files, totalling 78,700,000 bytes. */
const FILES: MediaFile[] = Array.from({ length: 11 }, (_, i) => ({
    path: `/p/copy-${i}.jpg`,
    name: `copy-${i}.jpg`,
    type: "image",
    size: i === 0 ? 8_700_000 : 7_000_000,
    identity: `id-${i}`,
}));
const PATHS = FILES.map((file) => file.path);

const status = () => screen.getByRole("status");
const show = (notice: ScanNotice, gone: ReadonlyMap<string, "trash" | "permanent"> = new Map()) =>
    act(() => useScanStore.setState({ notice, gone }));

describe("GroupsDeletionNotice", () => {
    beforeEach(() => {
        mockedRestore.mockReset();
        useScanStore.setState({ ...useScanStore.getInitialState(), status: "done", files: FILES }, true);
    });

    it("reports 11 files moved with the space freed and Undo", () => {
        render(<GroupsDeletionNotice />);

        show({ action: "trash", done: PATHS, failed: [] }, new Map(PATHS.map((path) => [path, "trash"])));

        expect(status()).toHaveTextContent("11 files moved to Trash · 78.7 MB freed");
        expect(screen.getByRole("button", { name: "Undo moving 11 files to Trash" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });

    it("offers no Undo for a deletion", () => {
        render(<GroupsDeletionNotice />);

        show(
            { action: "permanent", done: PATHS.slice(0, 2), failed: [] },
            new Map(PATHS.slice(0, 2).map((path) => [path, "permanent"])),
        );

        expect(status()).toHaveTextContent("2 files deleted");
        expect(screen.queryByRole("button", { name: /^Undo/ })).not.toBeInTheDocument();
    });

    it("names a file that failed, with the reason", () => {
        render(<GroupsDeletionNotice />);

        show({ action: "trash", done: [], failed: [{ path: PATHS[3] ?? "", message: "it changed" }] });

        expect(status()).toHaveTextContent("copy-3.jpg");
        expect(status()).toHaveTextContent("it changed");
    });

    it("restores every file still in the Trash on Undo, and moves focus to Dismiss", async () => {
        const moved = PATHS.slice(0, 2);
        mockedRestore.mockResolvedValue([
            { status: "restored", identity: "id-new-0" },
            { status: "restored", identity: "id-new-1" },
        ]);
        render(<GroupsDeletionNotice />);
        show({ action: "trash", done: moved, failed: [] }, new Map(moved.map((path) => [path, "trash"])));

        fireEvent.click(screen.getByRole("button", { name: "Undo moving 2 files to Trash" }));

        await waitFor(() => expect(status()).toHaveTextContent(/^2 files restored$/));
        expect(mockedRestore).toHaveBeenCalledExactlyOnceWith(["id-0", "id-1"]);
        await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss" })).toHaveFocus());
    });

    describe("hiding", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

        it("doesn't restart its timer when a mark is toggled while it is up", () => {
            render(<GroupsDeletionNotice />);
            show({ action: "trash", done: PATHS.slice(0, 1), failed: [] }, new Map([[PATHS[0] ?? "", "trash"]]));

            wait(HIDE_AFTER - 1000);
            act(() => useScanStore.getState().toggleMark(PATHS[5] ?? ""));
            wait(1000);

            expect(status()).toBeEmptyDOMElement();
            expect(useScanStore.getState().notice).toBeUndefined();
        });
    });
});
