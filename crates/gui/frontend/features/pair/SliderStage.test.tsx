import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import { SliderStage } from "./SliderStage";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));

const media = (name: string, type: MediaFile["type"] = "image"): MediaFile => ({
    path: `/media/${name}`,
    name,
    type,
    size: 1000,
    identity: `id-${name}`,
});

const A = media("IMG_2041.jpg");
const B = media("IMG_2041-edit.jpg");

/** The stage with its position held in state, as the screen holds it, recording every change. */
const Stateful = ({
    a = A,
    b = B,
    onChange,
}: {
    a?: MediaFile;
    b?: MediaFile;
    onChange: (position: number) => void;
}) => {
    const [position, setPosition] = useState(50);

    return (
        <SliderStage
            a={a}
            b={b}
            position={position}
            onPositionChange={(next) => {
                onChange(next);
                setPosition(next);
            }}
        />
    );
};

const slider = () => screen.getByRole("slider", { name: "Drag to compare A and B" });
const stage = () => screen.getByTestId("slider-stage");

/** The picture of `file`, which is decorative and so has no accessible role. */
const picture = (container: HTMLElement, file: MediaFile) =>
    container.querySelector(`img[src*="${file.identity}"]`) as HTMLImageElement;

/** Fires `load` on `file`'s picture. */
const load = (container: HTMLElement, file: MediaFile) => fireEvent.load(picture(container, file));

describe("SliderStage", () => {
    it("clips A to the left of the handle at 50", () => {
        render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} />);

        expect(screen.getByTestId("slider-a").style.clipPath).toBe("inset(0 50% 0 0)");
        expect(slider()).toHaveAttribute("aria-valuenow", "50");
        expect(slider()).toHaveAttribute("aria-valuetext", "50% A");
    });

    it("clips A from the position it is given", () => {
        render(<SliderStage a={A} b={B} position={30} onPositionChange={() => {}} />);

        expect(screen.getByTestId("slider-a").style.clipPath).toBe("inset(0 70% 0 0)");
    });

    it("puts B under A", () => {
        const { container } = render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} />);

        const images = [...container.querySelectorAll("img")];
        expect(images.map((img) => img.getAttribute("src"))).toEqual([
            "thumb://localhost/id-IMG_2041-edit.jpg?size=2048",
            "thumb://localhost/id-IMG_2041.jpg?size=2048",
        ]);
        expect(screen.getByTestId("slider-a")).toContainElement(picture(container, A));
    });

    it("moves by 1 with the arrows, 10 with Page Up/Down, and to the ends with Home/End", () => {
        const onChange = vi.fn();
        render(<Stateful onChange={onChange} />);

        fireEvent.keyDown(slider(), { key: "ArrowRight" });
        fireEvent.keyDown(slider(), { key: "PageDown" });
        fireEvent.keyDown(slider(), { key: "End" });

        expect(onChange.mock.calls).toEqual([[51], [41], [100]]);
        expect(slider()).toHaveAttribute("aria-valuenow", "100");

        fireEvent.keyDown(slider(), { key: "ArrowUp" });
        fireEvent.keyDown(slider(), { key: "Home" });
        fireEvent.keyDown(slider(), { key: "ArrowDown" });
        fireEvent.keyDown(slider(), { key: "PageUp" });
        fireEvent.keyDown(slider(), { key: "ArrowLeft" });

        expect(onChange.mock.calls.slice(3)).toEqual([[100], [0], [0], [10], [9]]);
    });

    it("fills the view edge to edge, with both pictures fitted whole", () => {
        const { container } = render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} />);

        expect(stage()).toHaveClass("flex-1", "bg-dots");
        expect(stage().style.aspectRatio).toBe("");
        for (const img of container.querySelectorAll("img")) expect(img).toHaveClass("object-contain");
        expect(stage()).toContainElement(slider());
    });

    it("keeps A's side opaque, so B never shows left of the handle", () => {
        const { container } = render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} />);

        expect(screen.getByTestId("slider-a")).toHaveClass("bg-background", "bg-dots");

        load(container, A);

        expect(screen.getByTestId("slider-a")).toHaveClass("bg-background", "bg-dots");
    });

    it("shows each side's kind icon until its picture loads", () => {
        const video = media("clip.mp4", "video");
        const { container } = render(<SliderStage a={A} b={video} position={50} onPositionChange={() => {}} />);

        expect(container.querySelector(".lucide-image")).toBeInTheDocument();
        expect(container.querySelector(".lucide-video")).toBeInTheDocument();

        load(container, A);

        expect(container.querySelector(".lucide-image")).not.toBeInTheDocument();
        expect(container.querySelector(".lucide-video")).toBeInTheDocument();
    });

    it("keeps the handle working when a picture can't be produced", () => {
        const onChange = vi.fn();
        const { container } = render(<Stateful onChange={onChange} />);

        fireEvent.error(picture(container, B));
        fireEvent.keyDown(slider(), { key: "ArrowLeft" });

        expect(onChange).toHaveBeenCalledExactlyOnceWith(49);
    });
});
