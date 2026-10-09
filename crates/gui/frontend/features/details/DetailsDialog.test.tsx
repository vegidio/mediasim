import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type MediaInfo, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { DetailsDialog } from "./DetailsDialog";
import { forgetFileDetails } from "./useFileDetails";

vi.mock("@/ipc/open", () => ({ openMedia: vi.fn(), revealMedia: vi.fn() }));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn() }));
vi.mock("@/ipc/set", () => ({ displayPath: vi.fn(async (path: string) => path) }));
vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    probeVideo: vi.fn(() => new Promise(() => {})),
    videoOpen: vi.fn(),
    videoNext: vi.fn(),
    videoClose: vi.fn(async () => {}),
}));

const FILES: MediaFile[] = ["IMG_1.jpg", "IMG_2.jpg", "VID_3.mov"].map((name, i) => ({
    path: `/p/${name}`,
    name,
    type: name.startsWith("VID") ? "video" : "image",
    size: 1000,
    identity: `id${i}`.padEnd(16, "0"),
}));

const onShow = vi.fn();
const onToggle = vi.fn();

/** The dialog on the `n`th file, counted from one. */
const openOn = (n: number) =>
    render(
        <DetailsDialog
            files={FILES}
            file={FILES[n - 1] as MediaFile}
            position={`${n} of 3`}
            onShow={onShow}
            onClose={() => {}}
            chips={null}
            action={
                <button type="button" onClick={onToggle}>
                    Flip
                </button>
            }
            onToggle={onToggle}
        />,
    );

const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
    forgetFileDetails();
    (probeMedia as Mock)
        .mockReset()
        .mockImplementation(
            async (path: string): Promise<MediaInfo> => ({ path, type: "image", width: 4, height: 3, size: 1000 }),
        );
});

describe("DetailsDialog, on Space", () => {
    it("flips the shown file without pressing the focused button, keeping focus and the file", () => {
        openOn(2);
        const previous = within(dialog()).getByRole("button", { name: "Previous file" });
        previous.focus();

        // Handled on both halves of the press, so neither presses the button.
        expect(fireEvent.keyDown(previous, { key: " " })).toBe(false);
        expect(fireEvent.keyUp(previous, { key: " " })).toBe(false);

        expect(onToggle).toHaveBeenCalledOnce();
        expect(onShow).not.toHaveBeenCalled();
        expect(previous).toHaveFocus();
        expect(dialog()).toHaveAccessibleName("Media details: IMG_2.jpg");
    });

    it("flips the file once while held down", () => {
        openOn(1);

        fireEvent.keyDown(dialog(), { key: " " });
        for (let i = 0; i < 3; i++) expect(fireEvent.keyDown(dialog(), { key: " ", repeat: true })).toBe(false);

        expect(onToggle).toHaveBeenCalledOnce();
    });

    it("leaves Space to the seek bar", async () => {
        openOn(3);
        const seek = await within(dialog()).findByRole("slider", { name: "Seek VID_3.mov" });

        expect(fireEvent.keyDown(seek, { key: " " })).toBe(true);
        expect(fireEvent.keyUp(seek, { key: " " })).toBe(true);

        expect(onToggle).not.toHaveBeenCalled();
    });
});
