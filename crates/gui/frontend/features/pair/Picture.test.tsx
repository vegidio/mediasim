import { fireEvent, render } from "@testing-library/react";
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
});
