import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { Picture } from "./Picture";

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

const picture = (container: HTMLElement) => container.querySelector("img") as HTMLImageElement;

describe("Picture", () => {
    it("shows the kind icon until the picture loads, in the box it is given", () => {
        const { container } = render(<Picture file={IMAGE} className="absolute inset-0" />);

        expect(container.firstElementChild).toHaveClass("absolute", "inset-0");
        expect(picture(container)).toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).toBeInTheDocument();

        fireEvent.load(picture(container));

        expect(picture(container)).not.toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).not.toBeInTheDocument();
    });

    it("shows the kind icon again when the picture can't be produced", () => {
        const { container } = render(<Picture file={IMAGE} />);
        fireEvent.load(picture(container));

        fireEvent.error(picture(container));

        expect(picture(container)).toHaveClass("invisible");
        expect(container.querySelector(".lucide-image")).toBeInTheDocument();
    });

    describe("overlay", () => {
        const frame = () => screen.getByTestId("picture-frame");
        const unspaced = (value: string) => value.replaceAll(" ", "");

        /** Loads the picture as one of `width` × `height` pixels. */
        const loadSized = (container: HTMLElement, width: number, height: number) => {
            Object.defineProperty(picture(container), "naturalWidth", { value: width });
            Object.defineProperty(picture(container), "naturalHeight", { value: height });
            fireEvent.load(picture(container));
        };

        it("fills the box until the picture's shape is known", () => {
            render(<Picture file={IMAGE} />);

            expect(frame()).toHaveClass("size-full");
            expect(frame().style.width).toBe("");
        });

        it("fits the frame to the picture's shape once loaded, centred in the box", () => {
            const { container } = render(<Picture file={IMAGE} />);

            loadSized(container, 1600, 900);

            // Spaces dropped, since the style declaration normalises them.
            const ratio = 1600 / 900;
            expect(unspaced(frame().style.width)).toBe(`min(100cqw,${ratio}*100cqh)`);
            expect(unspaced(frame().style.height)).toBe(`min(100cqh,100cqw/${ratio})`);
            expect(frame()).toHaveClass("left-1/2", "top-1/2");
            expect(container.firstElementChild).toHaveClass("[container-type:size]");
        });

        it("draws the overlay over the picture's frame once loaded, and not before", () => {
            const { container } = render(<Picture file={IMAGE} overlay={<span>wash</span>} />);

            expect(screen.queryByText("wash")).not.toBeInTheDocument();

            loadSized(container, 1600, 900);

            expect(frame()).toContainElement(screen.getByText("wash"));
        });

        it("hides the overlay again and fills the box when the picture can't be produced", () => {
            const { container } = render(<Picture file={IMAGE} overlay={<span>wash</span>} />);
            loadSized(container, 1600, 900);

            fireEvent.error(picture(container));

            expect(screen.queryByText("wash")).not.toBeInTheDocument();
            expect(frame().style.width).toBe("");
            expect(frame().style.height).toBe("");
        });
    });
});
