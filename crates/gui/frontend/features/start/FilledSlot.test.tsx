import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { usePairStore } from "@/stores/pair";
import { FilledSlot } from "./FilledSlot";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const IMAGE: MediaFile = {
    path: "/Pictures/IMG_2041.jpg",
    name: "IMG_2041.jpg",
    type: "image",
    size: 4_800_000,
    identity: "0123456789abcdef",
};

const VIDEO: MediaFile = {
    path: "/Movies/clip.mov",
    name: "clip.mov",
    type: "video",
    size: 52_300_000,
    identity: "fedcba9876543210",
};

/** The slot's picture, which is decorative and so has no accessible role. */
const picture = (container: HTMLElement) => container.querySelector("img") as HTMLImageElement;

describe("FilledSlot", () => {
    const remove = vi.fn();

    beforeEach(() => {
        usePairStore.setState({ remove });
    });

    it("shows an image's picture, badge, remove button, name and size", () => {
        const { container } = render(<FilledSlot slot="a" file={IMAGE} />);
        const group = screen.getByRole("group", { name: "File A" });

        expect(picture(container)).toHaveAttribute("src", "thumb://localhost/0123456789abcdef?size=768");
        expect(picture(container)).toHaveAttribute("alt", "");
        expect(within(group).getByText("A")).toBeInTheDocument();
        expect(within(group).getByRole("button", { name: "Remove file A" })).toBeInTheDocument();
        expect(within(group).getByText("IMG_2041.jpg")).toHaveAttribute("title", "IMG_2041.jpg");
        expect(within(group).getByText("IMG_2041.jpg")).toHaveClass("truncate");
        expect(within(group).getByText("4.8 MB")).toBeInTheDocument();
    });

    it("shows a video's badge, remove button and size", () => {
        render(<FilledSlot slot="b" file={VIDEO} />);
        const group = screen.getByRole("group", { name: "File B" });

        expect(within(group).getByText("B")).toBeInTheDocument();
        expect(within(group).getByRole("button", { name: "Remove file B" })).toBeInTheDocument();
        expect(within(group).getByText("clip.mov")).toBeInTheDocument();
        expect(within(group).getByText("52.3 MB")).toBeInTheDocument();
    });

    it("shows the kind icon until the picture loads", () => {
        const { container } = render(<FilledSlot slot="a" file={IMAGE} />);

        expect(picture(container)).toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).toBeInTheDocument();

        fireEvent.load(picture(container));

        expect(picture(container)).not.toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).not.toBeInTheDocument();
    });

    it("keeps the kind icon, name and size when the picture can't be produced", () => {
        const { container } = render(<FilledSlot slot="b" file={VIDEO} />);

        fireEvent.error(picture(container));

        expect(picture(container)).toHaveClass("invisible");
        expect(container.querySelector(".lucide-video")).toBeInTheDocument();
        expect(screen.getByText("clip.mov")).toBeInTheDocument();
        expect(screen.getByText("52.3 MB")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Remove file B" })).toBeInTheDocument();
    });

    it("starts loading afresh when its file is replaced", () => {
        const { container, rerender } = render(<FilledSlot slot="a" file={IMAGE} />);
        fireEvent.load(picture(container));

        rerender(<FilledSlot slot="a" file={{ ...IMAGE, identity: "1111111111111111" }} />);

        expect(picture(container)).toHaveClass("invisible");
    });

    it("removes its file from the store and reports it", () => {
        const onRemove = vi.fn();
        render(<FilledSlot slot="b" file={VIDEO} onRemove={onRemove} />);

        fireEvent.click(screen.getByRole("button", { name: "Remove file B" }));

        expect(remove).toHaveBeenCalledExactlyOnceWith("b");
        expect(onRemove).toHaveBeenCalledOnce();
    });
});
