import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { openMedia } from "@/ipc/open";
import { type MediaInfo, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { useGalleryStore } from "@/stores/gallery";
import { DetailsDialog } from "./DetailsDialog";
import { forgetFileDetails } from "./useFileDetails";

vi.mock("@/ipc/open", () => ({ openMedia: vi.fn(), revealMedia: vi.fn() }));
vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn() }));
vi.mock("@/ipc/set", () => ({ displayPath: vi.fn(async (path: string) => path), listSetMedia: vi.fn() }));
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

const mockedProbe = probeMedia as Mock;
const mockedOpen = openMedia as Mock;

/** 48 files, `IMG_01.jpg` to `IMG_48.jpg`, with the 5th a video. */
const FILES: MediaFile[] = Array.from({ length: 48 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    const video = i === 4;
    return {
        path: `/p/${video ? `VID_${n}.mov` : `IMG_${n}.jpg`}`,
        name: video ? `VID_${n}.mov` : `IMG_${n}.jpg`,
        type: video ? "video" : "image",
        size: 1000,
        identity: `id${n}`.padEnd(16, "0"),
    };
});

const nth = (n: number) => FILES[n - 1] as MediaFile;

/** The dialog as the gallery shows it, on whichever file the store holds. */
const Harness = () => {
    const path = useGalleryStore((state) => state.details);
    const file = FILES.find((candidate) => candidate.path === path);
    return file ? <DetailsDialog files={FILES} file={file} /> : null;
};

const openOn = (n: number) => {
    useGalleryStore.getState().openDetails(nth(n).path);
    return render(<Harness />);
};

const dialog = () => screen.getByRole("dialog");
const button = (name: string) => within(dialog()).getByRole("button", { name });
const shownPath = () => useGalleryStore.getState().details;

beforeEach(() => {
    forgetFileDetails();
    useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    mockedProbe.mockReset().mockImplementation(
        async (path: string): Promise<MediaInfo> => ({
            path,
            type: "image",
            width: 4032,
            height: 3024,
            size: 1000,
        }),
    );
});

describe("DetailsDialog", () => {
    it("is named after the file, and reads its position among every file", () => {
        useGalleryStore.getState().setFilter("videos");
        openOn(4);

        expect(screen.getByRole("dialog", { name: "Media details: IMG_04.jpg" })).toBeInTheDocument();
        expect(within(dialog()).getByText("4 of 48")).toBeInTheDocument();
    });

    it("steps with Next and Previous, through files the tab leaves out", () => {
        useGalleryStore.getState().setFilter("videos");
        openOn(4);

        fireEvent.click(button("Next file"));
        expect(shownPath()).toBe(nth(5).path);
        expect(within(dialog()).getByText("5 of 48")).toBeInTheDocument();

        fireEvent.click(button("Next file"));
        fireEvent.click(button("Previous file"));
        fireEvent.click(button("Previous file"));
        expect(shownPath()).toBe(nth(4).path);
    });

    it("steps with the arrow keys", () => {
        openOn(4);

        fireEvent.keyDown(dialog(), { key: "ArrowRight" });
        expect(shownPath()).toBe(nth(5).path);

        fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
        fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
        expect(shownPath()).toBe(nth(3).path);
    });

    it("disables Next on the last file, where → does nothing", () => {
        openOn(48);

        expect(button("Next file")).toBeDisabled();
        expect(button("Previous file")).toBeEnabled();

        fireEvent.keyDown(dialog(), { key: "ArrowRight" });
        expect(shownPath()).toBe(nth(48).path);
    });

    it("disables Previous on the first file, where ← does nothing", () => {
        openOn(1);

        expect(button("Previous file")).toBeDisabled();

        fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
        expect(shownPath()).toBe(nth(1).path);
    });

    it("leaves → to the seek bar", async () => {
        openOn(5);
        const seek = await within(dialog()).findByRole("slider", { name: "Seek VID_05.mov" });

        fireEvent.keyDown(seek, { key: "ArrowRight" });

        expect(shownPath()).toBe(nth(5).path);
    });

    it("closes on Escape, handing focus back to the tile", () => {
        openOn(4);
        fireEvent.click(button("Next file"));

        fireEvent.keyDown(dialog(), { key: "Escape" });

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(useGalleryStore.getState().focusTile).toBe(nth(5).path);
    });

    it("closes with Close", () => {
        openOn(4);

        fireEvent.click(button("Close"));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(useGalleryStore.getState().focusTile).toBe(nth(4).path);
    });

    it("opens the shown file, and drops a failure's message on stepping to the next file", async () => {
        mockedOpen.mockReset().mockRejectedValueOnce({ kind: "missing", message: "it no longer exists" });
        openOn(4);

        fireEvent.click(button("Open in app"));

        expect(mockedOpen).toHaveBeenCalledExactlyOnceWith(nth(4).identity);
        expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Couldn't open this file.");

        fireEvent.click(button("Next file"));

        expect(shownPath()).toBe(nth(5).path);
        expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
    });

    describe("the comparison button", () => {
        /** The chips above the sidebar's sections. */
        const chips = () =>
            within(within(dialog()).getByRole("complementary", { name: "File details" }))
                .getAllByText(/^(Image|Video|Not included|Removed)$/)
                .filter((chip) => !chip.closest("section"))
                .map((chip) => chip.textContent);

        it("removes the file and adds it back, keeping focus on the button and the dialog on the file", () => {
            openOn(4);
            const toggle = button("Remove from comparison");
            toggle.focus();

            fireEvent.click(toggle);

            expect(useGalleryStore.getState().overrides).toEqual(new Set([nth(4).path]));
            expect(toggle).toHaveAccessibleName("Add back to comparison");
            expect(toggle).toHaveFocus();
            expect(chips()).toEqual(["Image", "Removed"]);
            expect(shownPath()).toBe(nth(4).path);
            expect(within(dialog()).getByText("4 of 48")).toBeInTheDocument();

            fireEvent.click(toggle);

            expect(useGalleryStore.getState().overrides).toEqual(new Set());
            expect(toggle).toHaveAccessibleName("Remove from comparison");
            expect(toggle).toHaveFocus();
            expect(chips()).toEqual(["Image"]);
        });

        it("adds a file the tab leaves out and takes it out again, keeping focus and the file", () => {
            useGalleryStore.getState().setFilter("images");
            openOn(5);
            expect(chips()).toEqual(["Video", "Not included"]);
            const toggle = button("Add to comparison");
            toggle.focus();

            fireEvent.click(toggle);

            expect(useGalleryStore.getState().overrides).toEqual(new Set([nth(5).path]));
            expect(toggle).toHaveAccessibleName("Remove from comparison");
            expect(toggle).toHaveFocus();
            expect(chips()).toEqual(["Video"]);
            expect(shownPath()).toBe(nth(5).path);
            expect(within(dialog()).getByText("5 of 48")).toBeInTheDocument();

            fireEvent.click(toggle);

            expect(useGalleryStore.getState().overrides).toEqual(new Set());
            expect(toggle).toHaveAccessibleName("Add to comparison");
            expect(toggle).toHaveFocus();
            expect(chips()).toEqual(["Video", "Not included"]);
        });

        it("reads Add back for a file removed earlier, and Remove for the next one", () => {
            useGalleryStore.getState().toggle(nth(4).path);
            openOn(4);

            expect(button("Add back to comparison")).toBeInTheDocument();

            fireEvent.click(button("Next file"));

            expect(button("Remove from comparison")).toBeInTheDocument();
        });
    });

    describe("a click on the backdrop", () => {
        const backdrop = () => document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;

        /** Open the dialog, then press on the backdrop `elapsed` ms later. */
        const pressBackdropAfter = async (elapsed: number) => {
            const now = vi.spyOn(performance, "now").mockReturnValue(1000);
            openOn(4);
            // Radix starts listening for outside presses a tick after opening.
            await act(() => new Promise((resolve) => setTimeout(resolve)));
            now.mockReturnValue(1000 + elapsed);

            // Radix dismisses a primary-button press outside once its click follows.
            fireEvent.pointerDown(backdrop());
            fireEvent.click(backdrop());
        };

        it("closes it, handing focus back to the tile", async () => {
            await pressBackdropAfter(600);

            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(useGalleryStore.getState().focusTile).toBe(nth(4).path);
        });

        it("keeps it open when it is the second click of the double click that opened it", async () => {
            await pressBackdropAfter(200);

            expect(dialog()).toBeInTheDocument();
            expect(shownPath()).toBe(nth(4).path);
        });
    });

    it("starts at 4:3, then takes each file's probed shape, keeping the last until the next is read", async () => {
        const ratio = () => dialog().style.getPropertyValue("--ratio");
        let answer: (info: MediaInfo) => void = () => {};
        mockedProbe.mockImplementation(
            () =>
                new Promise<MediaInfo>((resolve) => {
                    answer = resolve;
                }),
        );
        openOn(3);
        expect(Number(ratio())).toBeCloseTo(4 / 3);

        await act(async () => answer({ path: nth(3).path, type: "image", width: 1080, height: 1920, size: 1 }));
        await waitFor(() => expect(Number(ratio())).toBeCloseTo(1080 / 1920));

        fireEvent.click(button("Next file"));
        expect(Number(ratio())).toBeCloseTo(1080 / 1920);

        await act(async () => answer({ path: nth(4).path, type: "image", width: 1920, height: 1080, size: 1 }));
        await waitFor(() => expect(Number(ratio())).toBeCloseTo(16 / 9));
    });

    describe("when the details can't be read, takes the picture's shape", () => {
        const ratio = () => dialog().style.getPropertyValue("--ratio");

        /** Loads the stage's picture as `width` × `height`. */
        const loadPicture = (width: number, height: number) => {
            const img = within(screen.getByTestId("details-stage")).getByRole("presentation", { hidden: true });
            Object.defineProperties(img, { naturalWidth: { value: width }, naturalHeight: { value: height } });
            fireEvent.load(img);
        };

        let fail: (error: Error) => void = () => {};

        beforeEach(() => {
            mockedProbe.mockImplementation(
                () =>
                    new Promise<MediaInfo>((_, reject) => {
                        fail = reject;
                    }),
            );
            vi.spyOn(console, "error").mockImplementation(() => {});
        });

        it("loaded before they failed", async () => {
            openOn(3);

            loadPicture(1080, 1920);
            expect(Number(ratio())).toBeCloseTo(4 / 3);

            await act(async () => fail(new Error("unreadable")));
            await waitFor(() => expect(Number(ratio())).toBeCloseTo(1080 / 1920));
        });

        it("loaded after they failed", async () => {
            openOn(3);

            await act(async () => fail(new Error("unreadable")));
            loadPicture(1080, 1920);

            await waitFor(() => expect(Number(ratio())).toBeCloseTo(1080 / 1920));
        });
    });
});
