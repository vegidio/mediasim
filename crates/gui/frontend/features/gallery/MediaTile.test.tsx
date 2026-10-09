import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import type { Inclusion } from "@/lib/gallery";
import { useGalleryStore } from "@/stores/gallery";
import { DURATION_DWELL_MS, MediaTile, PlaceholderTile } from "./MediaTile";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({ probeVideo: vi.fn() }));

const mockedProbe = probeVideo as Mock;

const image: MediaFile = {
    path: "/p/IMG_2041.jpg",
    name: "IMG_2041.jpg",
    type: "image",
    size: 4_800_000,
    identity: "0123456789abcdef",
};

const video: MediaFile = {
    path: "/p/VID_0714.mov",
    name: "VID_0714.mov",
    type: "video",
    size: 312_000_000,
    identity: "fedcba9876543210",
};

/** Render the tile of `file`, unselected unless `selected` says so, with `onSelect` called on a select. */
const renderTile = (
    file: MediaFile,
    inclusion: Inclusion = "included",
    { selected = false, onSelect = () => {} }: { selected?: boolean; onSelect?: () => void } = {},
) => render(<MediaTile id="tile" file={file} inclusion={inclusion} selected={selected} onSelect={onSelect} />);

const picture = (container: HTMLElement) => container.querySelector("img");
const open = (name: string) => screen.getByRole("button", { name: `Open ${name}` });
/** The whole tile: the element holding its picture, name and size. */
const tile = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const shown = () => useGalleryStore.getState().details;
/** The element drawing the lime ring, if any. */
const ring = (container: HTMLElement) => container.querySelector(".ring-2");
/** The elements dimmed and in grayscale. */
const dimmed = (container: HTMLElement) => Array.from(container.querySelectorAll(".grayscale"));

describe("MediaTile", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the name and size, with one button named after the file", () => {
        const { container } = renderTile(image);

        expect(tile(container)).toHaveTextContent("IMG_2041.jpg");
        expect(tile(container)).toHaveTextContent("4.8 MB");
        expect(tile(container)).not.toHaveAttribute("title");
        expect(screen.getAllByRole("button")).toEqual([open("IMG_2041.jpg")]);
    });

    it("opens the media details from its Open button", () => {
        renderTile(image);

        fireEvent.click(open("IMG_2041.jpg"));

        expect(shown()).toBe("/p/IMG_2041.jpg");
    });

    it("keeps its Open button out of the tab order", () => {
        renderTile(image);

        expect(open("IMG_2041.jpg")).toHaveAttribute("tabindex", "-1");
    });

    it("selects on a click anywhere on it", () => {
        const onSelect = vi.fn();
        renderTile(image, "included", { onSelect });

        fireEvent.click(screen.getByText("4.8 MB"));

        expect(onSelect).toHaveBeenCalledOnce();
        expect(shown()).toBeUndefined();
    });

    it("selects and opens on a click on its Open button", () => {
        const onSelect = vi.fn();
        renderTile(image, "included", { onSelect });

        fireEvent.click(open("IMG_2041.jpg"));

        expect(onSelect).toHaveBeenCalledOnce();
        expect(shown()).toBe("/p/IMG_2041.jpg");
    });

    it("shows the lime ring and its Open button only when selected", () => {
        const { container, rerender } = renderTile(image);

        expect(ring(container)).toBeNull();
        expect(screen.getByRole("gridcell")).toHaveAttribute("aria-selected", "false");
        // Shown on hover alone, without the ring.
        expect(open("IMG_2041.jpg")).toHaveClass("opacity-0", "group-hover:opacity-100");

        rerender(<MediaTile id="tile" file={image} inclusion="included" selected onSelect={() => {}} />);

        expect(ring(container)).toBeInTheDocument();
        expect(screen.getByRole("gridcell")).toHaveAttribute("aria-selected", "true");
        expect(open("IMG_2041.jpg")).toHaveClass("opacity-100");
        expect(open("IMG_2041.jpg")).not.toHaveClass("opacity-0");
    });

    it("opens the media details on a double click on the name", () => {
        renderTile(video);

        fireEvent.doubleClick(screen.getByText("VID_0714.mov"));

        expect(shown()).toBe("/p/VID_0714.mov");
    });

    it("asks for the picture at 512 and shimmers until it loads", () => {
        const { container } = renderTile(image);
        const img = picture(container);

        expect(img).toHaveAttribute("src", "thumb://localhost/0123456789abcdef?size=512");
        expect(screen.getByTestId("shimmer")).toBeInTheDocument();
        expect(img).toHaveClass("invisible");

        fireEvent.load(img as HTMLImageElement);

        expect(screen.queryByTestId("shimmer")).not.toBeInTheDocument();
        expect(img).not.toHaveClass("invisible");
    });

    it("shows the icon of the file's kind when the picture can't be produced", () => {
        const { container } = renderTile(image);

        fireEvent.error(picture(container) as HTMLImageElement);

        expect(screen.queryByTestId("shimmer")).not.toBeInTheDocument();
        expect(container.querySelector("svg.lucide-image")).toBeInTheDocument();
    });

    it("dims a left-out file with a tooltip, keeping it openable", () => {
        const { container } = renderTile(image, "left-out");

        expect(tile(container)).toHaveAttribute("title", "Not included in this comparison");
        expect(dimmed(container)).toHaveLength(2);
        for (const element of dimmed(container)) expect(element).toHaveClass("opacity-28");

        fireEvent.click(open("IMG_2041.jpg"));
        expect(shown()).toBe("/p/IMG_2041.jpg");
    });

    it("dims a removed file, without a mark, keeping it openable", () => {
        const { container } = renderTile(image, "removed");

        expect(tile(container)).toHaveAttribute("title", "Removed from this comparison");
        expect(dimmed(container)).toHaveLength(2);
        expect(screen.queryByText("Removed")).not.toBeInTheDocument();

        fireEvent.click(open("IMG_2041.jpg"));
        expect(shown()).toBe("/p/IMG_2041.jpg");
    });

    it.each(["removed", "left-out"] as const)(
        "keeps the ring of a selected %s file outside the dimming",
        (inclusion) => {
            const { container } = renderTile(image, inclusion, { selected: true });
            const lime = ring(container) as HTMLElement;

            expect(lime).toBeInTheDocument();
            expect(lime).not.toHaveClass("grayscale");
            expect(dimmed(container)).toHaveLength(2);
            for (const element of dimmed(container)) expect(element).not.toContainElement(lime);
            // What is dimmed is the picture and the text below it.
            expect(dimmed(container)[0]).toContainElement(picture(container));
            expect(dimmed(container)[1]).toHaveTextContent("IMG_2041.jpg");
        },
    );

    it("has no dimming and no tooltip when included", () => {
        const { container } = renderTile(image);

        expect(tile(container)).not.toHaveAttribute("title");
        expect(dimmed(container)).toHaveLength(0);
        expect(screen.queryByText("Removed")).not.toBeInTheDocument();
    });

    it("shows a video's duration once read", async () => {
        mockedProbe.mockResolvedValue({ format: "mov", duration: 42.7 });
        const { container } = renderTile(video);
        expect(tile(container)).not.toHaveTextContent("0:42");

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS));

        expect(mockedProbe).toHaveBeenCalledExactlyOnceWith("fedcba9876543210");
        expect(tile(container)).toHaveTextContent("0:42");
    });

    it("shows no badge when the duration can't be read", async () => {
        mockedProbe.mockRejectedValue({ kind: "unreadable", message: "boom" });
        renderTile(video);

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS));

        expect(mockedProbe).toHaveBeenCalledOnce();
        expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
    });

    it("reads no duration for a tile gone within the dwell", async () => {
        const { unmount } = renderTile(video);

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS - 1));
        unmount();
        await vi.advanceTimersByTimeAsync(DURATION_DWELL_MS);

        expect(mockedProbe).not.toHaveBeenCalled();
    });

    it("reads no duration for an image", async () => {
        renderTile(image);

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS));

        expect(mockedProbe).not.toHaveBeenCalled();
    });
});

describe("PlaceholderTile", () => {
    it("shimmers, hidden from assistive technology", () => {
        render(<PlaceholderTile />);

        expect(screen.getByTestId("placeholder-tile")).toHaveAttribute("aria-hidden", "true");
    });
});
