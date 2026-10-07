import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
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

const picture = (container: HTMLElement) => container.querySelector("img");
const open = (name: string) => screen.getByRole("button", { name: `Open ${name}` });
/** The whole tile: the element holding its picture, name and size. */
const tile = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const shown = () => useGalleryStore.getState().details;

describe("MediaTile", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the name and size, with one button named after the file", () => {
        const { container } = render(<MediaTile file={image} included />);

        expect(tile(container)).toHaveTextContent("IMG_2041.jpg");
        expect(tile(container)).toHaveTextContent("4.8 MB");
        expect(tile(container)).not.toHaveAttribute("title");
        expect(screen.getAllByRole("button")).toEqual([open("IMG_2041.jpg")]);
    });

    it("opens the media details from its Open button", () => {
        render(<MediaTile file={image} included />);

        fireEvent.click(open("IMG_2041.jpg"));

        expect(shown()).toBe("/p/IMG_2041.jpg");
    });

    it("opens the media details on Enter, as a button does", () => {
        render(<MediaTile file={image} included />);
        open("IMG_2041.jpg").focus();

        // jsdom doesn't turn Enter on a button into a click, so this checks the element is a real button that will.
        expect(open("IMG_2041.jpg")).toHaveFocus();
        expect(open("IMG_2041.jpg").tagName).toBe("BUTTON");
        expect(open("IMG_2041.jpg")).toHaveAttribute("type", "button");
    });

    it("opens the media details on a double click on the name", () => {
        render(<MediaTile file={video} included />);

        fireEvent.doubleClick(screen.getByText("VID_0714.mov"));

        expect(shown()).toBe("/p/VID_0714.mov");
    });

    it("asks for the picture at 512 and shimmers until it loads", () => {
        const { container } = render(<MediaTile file={image} included />);
        const img = picture(container);

        expect(img).toHaveAttribute("src", "thumb://localhost/0123456789abcdef?size=512");
        expect(screen.getByTestId("shimmer")).toBeInTheDocument();
        expect(img).toHaveClass("invisible");

        fireEvent.load(img as HTMLImageElement);

        expect(screen.queryByTestId("shimmer")).not.toBeInTheDocument();
        expect(img).not.toHaveClass("invisible");
    });

    it("shows the icon of the file's kind when the picture can't be produced", () => {
        const { container } = render(<MediaTile file={image} included />);

        fireEvent.error(picture(container) as HTMLImageElement);

        expect(screen.queryByTestId("shimmer")).not.toBeInTheDocument();
        expect(container.querySelector("svg.lucide-image")).toBeInTheDocument();
    });

    it("dims a left-out file with a tooltip, keeping it focusable and openable", () => {
        const { container } = render(<MediaTile file={image} included={false} />);

        expect(tile(container)).toHaveAttribute("title", "Not included in this comparison");
        expect(tile(container)).toHaveClass("opacity-28", "grayscale");

        open("IMG_2041.jpg").focus();
        expect(open("IMG_2041.jpg")).toHaveFocus();

        fireEvent.click(open("IMG_2041.jpg"));
        expect(shown()).toBe("/p/IMG_2041.jpg");
    });

    it("shows a video's duration once read", async () => {
        mockedProbe.mockResolvedValue({ format: "mov", duration: 42.7 });
        const { container } = render(<MediaTile file={video} included />);
        expect(tile(container)).not.toHaveTextContent("0:42");

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS));

        expect(mockedProbe).toHaveBeenCalledExactlyOnceWith("fedcba9876543210");
        expect(tile(container)).toHaveTextContent("0:42");
    });

    it("shows no badge when the duration can't be read", async () => {
        mockedProbe.mockRejectedValue({ kind: "unreadable", message: "boom" });
        render(<MediaTile file={video} included />);

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS));

        expect(mockedProbe).toHaveBeenCalledOnce();
        expect(screen.queryByText(/^\d+:\d{2}$/)).not.toBeInTheDocument();
    });

    it("reads no duration for a tile gone within the dwell", async () => {
        const { unmount } = render(<MediaTile file={video} included />);

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS - 1));
        unmount();
        await vi.advanceTimersByTimeAsync(DURATION_DWELL_MS);

        expect(mockedProbe).not.toHaveBeenCalled();
    });

    it("reads no duration for an image", async () => {
        render(<MediaTile file={image} included />);

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
