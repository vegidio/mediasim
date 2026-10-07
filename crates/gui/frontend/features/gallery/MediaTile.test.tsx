import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
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
const tile = (name: string) => screen.getByRole("button", { name: `Open ${name}` });

describe("MediaTile", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the name and size, and is named after the file", () => {
        render(<MediaTile file={image} included />);

        expect(tile("IMG_2041.jpg")).toHaveTextContent("IMG_2041.jpg");
        expect(tile("IMG_2041.jpg")).toHaveTextContent("4.8 MB");
        expect(tile("IMG_2041.jpg")).not.toHaveAttribute("title");
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

    it("dims a left-out file with a tooltip, keeping it focusable", () => {
        render(<MediaTile file={image} included={false} />);

        expect(tile("IMG_2041.jpg")).toHaveAttribute("title", "Not included in this comparison");
        expect(tile("IMG_2041.jpg")).toHaveClass("opacity-28", "grayscale");

        tile("IMG_2041.jpg").focus();
        expect(tile("IMG_2041.jpg")).toHaveFocus();
    });

    it("shows a video's duration once read", async () => {
        mockedProbe.mockResolvedValue({ format: "mov", duration: 42.7 });
        render(<MediaTile file={video} included />);
        expect(tile("VID_0714.mov")).not.toHaveTextContent("0:42");

        await act(() => vi.advanceTimersByTimeAsync(DURATION_DWELL_MS));

        expect(mockedProbe).toHaveBeenCalledExactlyOnceWith("fedcba9876543210");
        expect(tile("VID_0714.mov")).toHaveTextContent("0:42");
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
