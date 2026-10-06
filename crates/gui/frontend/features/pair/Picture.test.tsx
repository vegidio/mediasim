import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { barStyle, Picture } from "./Picture";

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

    describe("media and bar", () => {
        const frame = () => screen.getByTestId("picture-frame");
        const bar = () => screen.getByTestId("picture-bar");
        /** `value` as the style declaration serialises it, which reorders and simplifies math. */
        const serialised = (property: string, value: string) => {
            const probe = document.createElement("div");
            probe.style.setProperty(property, value);
            return probe.style.getPropertyValue(property);
        };

        const loadSized = (container: HTMLElement, width: number, height: number) => {
            Object.defineProperty(picture(container), "naturalWidth", { value: width });
            Object.defineProperty(picture(container), "naturalHeight", { value: height });
            fireEvent.load(picture(container));
        };

        /** A stand-in for a video. */
        const slots = <i data-testid="media" />;

        it("stacks the still, media and overlay in the frame, and the bar after the frame", () => {
            const { container } = render(
                <Picture
                    file={IMAGE}
                    media={slots}
                    overlay={<i data-testid="overlay" />}
                    bar={<i data-testid="bar" />}
                />,
            );
            loadSized(container, 1600, 900);

            expect(
                [...frame().children].map((child) => child.tagName === "IMG" || child.getAttribute("data-testid")),
            ).toEqual([true, "media", "overlay"]);
            expect(frame()).not.toContainElement(bar());
            expect(frame().nextElementSibling).toBe(bar());
            expect(bar()).toContainElement(screen.getByTestId("bar"));
        });

        it("draws media before the picture has loaded, and when it can't be produced", () => {
            const { container } = render(<Picture file={IMAGE} media={slots} />);

            expect(frame()).toContainElement(screen.getByTestId("media"));

            fireEvent.error(picture(container));

            expect(frame()).toContainElement(screen.getByTestId("media"));
        });

        it("sizes the bar to the picture's width and sits it on the picture's bottom edge once loaded", () => {
            const { container } = render(<Picture file={IMAGE} bar={<i />} />);

            loadSized(container, 1080, 1920);

            const ratio = 1080 / 1920;
            const width = `clamp(min(280px, 100cqw), min(100cqw, ${ratio} * 100cqh) - 24px, 100cqw)`;
            const bottom = `calc((100cqh - min(100cqh, 100cqw / ${ratio})) / 2 + 12px)`;
            expect(bar().style.width).not.toBe("");
            expect(bar().style.width).toBe(serialised("width", width));
            expect(bar().style.bottom).not.toBe("");
            expect(bar().style.bottom).toBe(serialised("bottom", bottom));
            expect(bar()).toHaveClass("left-1/2", "-translate-x-1/2");
        });

        it("sits the bar on the box's bottom edge before the picture has loaded", () => {
            render(<Picture file={IMAGE} bar={<i />} />);

            expect(bar().style.width).toBe("");
            expect(bar().style.bottom).toBe("");
            expect(bar()).toHaveClass("absolute", "bottom-3", "w-[max(calc(100%-24px),min(280px,100%))]");
        });

        it("reports the picture's ratio once loaded, and undefined when it can't be produced", () => {
            const onRatio = vi.fn();
            const { container } = render(<Picture file={IMAGE} onRatio={onRatio} />);

            loadSized(container, 1600, 900);

            expect(onRatio).toHaveBeenLastCalledWith(1600 / 900);

            fireEvent.error(picture(container));

            expect(onRatio).toHaveBeenLastCalledWith(undefined);
        });

        it("widens a shared bar to the wider picture and sits it on the taller one's bottom edge", () => {
            const wide = 16 / 9;
            const tall = 9 / 16;

            expect(barStyle(wide, tall)).toEqual({
                width: `clamp(min(280px, 100cqw), min(100cqw, ${wide} * 100cqh) - 24px, 100cqw)`,
                bottom: `calc((100cqh - min(100cqh, 100cqw / ${tall})) / 2 + 12px)`,
            });
        });

        it("draws no bar box without a bar", () => {
            render(<Picture file={IMAGE} />);

            expect(screen.queryByTestId("picture-bar")).not.toBeInTheDocument();
        });
    });
});
