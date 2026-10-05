import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Slot } from "@/features/start/routePairDrop";
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
const UNMARKED = { a: false, b: false };

/** The stage with its position held in state, as the screen holds it, recording every change. */
const Stateful = ({
    a = A,
    b = B,
    marked = UNMARKED,
    onChange,
}: {
    a?: MediaFile;
    b?: MediaFile;
    marked?: Record<Slot, boolean>;
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
            marked={marked}
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
        render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />);

        expect(screen.getByTestId("slider-a").style.clipPath).toBe("inset(0 50% 0 0)");
        expect(slider()).toHaveAttribute("aria-valuenow", "50");
        expect(slider()).toHaveAttribute("aria-valuetext", "50% A");
    });

    it("clips A from the position it is given", () => {
        render(<SliderStage a={A} b={B} position={30} onPositionChange={() => {}} marked={UNMARKED} />);

        expect(screen.getByTestId("slider-a").style.clipPath).toBe("inset(0 70% 0 0)");
    });

    it("puts B under A", () => {
        const { container } = render(
            <SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />,
        );

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
        const { container } = render(
            <SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />,
        );

        expect(stage()).toHaveClass("flex-1", "bg-dots");
        expect(stage().style.aspectRatio).toBe("");
        for (const img of container.querySelectorAll("img")) expect(img).toHaveClass("object-contain");
        expect(stage()).toContainElement(slider());
    });

    it("keeps A's side opaque, so B never shows left of the handle", () => {
        const { container } = render(
            <SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />,
        );

        expect(screen.getByTestId("slider-a")).toHaveClass("bg-background", "bg-dots");

        load(container, A);

        expect(screen.getByTestId("slider-a")).toHaveClass("bg-background", "bg-dots");
    });

    it("shows each side's kind icon until its picture loads", () => {
        const video = media("clip.mp4", "video");
        const { container } = render(
            <SliderStage a={A} b={video} position={50} onPositionChange={() => {}} marked={UNMARKED} />,
        );

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

    describe("delete tags", () => {
        const tag = (slot: Slot) => screen.queryByTestId(`delete-tag-${slot}`);

        it("shows no tag while nothing is marked", () => {
            render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />);

            expect(tag("a")).not.toBeInTheDocument();
            expect(tag("b")).not.toBeInTheDocument();
            expect(screen.queryByText(/Delete/)).not.toBeInTheDocument();
        });

        it("tags only B, top right, when B is marked", () => {
            render(
                <SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={{ a: false, b: true }} />,
            );

            expect(tag("a")).not.toBeInTheDocument();
            expect(tag("b")).toHaveTextContent("B · Delete");
            expect(tag("b")).toHaveClass("top-2.5", "right-2.5");
        });

        it("tags A top left, outside its clipped layer, so it stays whole at 0", () => {
            render(<SliderStage a={A} b={B} position={0} onPositionChange={() => {}} marked={{ a: true, b: false }} />);

            expect(tag("a")).toHaveTextContent("A · Delete");
            expect(tag("a")).toHaveClass("top-2.5", "left-2.5");
            expect(screen.getByTestId("slider-a")).not.toContainElement(tag("a"));
            expect(stage()).toContainElement(tag("a"));
        });

        it("draws the tags above the line and the handle, click-through and hidden", () => {
            render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={{ a: true, b: true }} />);

            for (const slot of ["a", "b"] as const) {
                const element = tag(slot) as HTMLElement;
                expect(element).toHaveClass("pointer-events-none");
                expect(element).toHaveAttribute("aria-hidden", "true");
                expect(slider().compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            }
        });

        it("washes neither side while nothing is marked", () => {
            render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />);

            expect(screen.queryByTestId("mark-wash")).not.toBeInTheDocument();
        });

        it("washes A's picture alone, inside its clipped layer, so only A's side is tinted", () => {
            const { container } = render(
                <SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={{ a: true, b: false }} />,
            );
            load(container, A);

            const wash = screen.getByTestId("mark-wash");
            expect(screen.getByTestId("slider-a")).toContainElement(wash);
            expect(picture(container, A).parentElement).toContainElement(wash);
            expect(wash).toHaveClass(
                "pointer-events-none",
                "bg-[rgba(69,10,10,.62)]",
                "shadow-[inset_0_0_0_2px_#EF4444]",
            );
        });

        it("washes B's picture alone, under A's layer, so only B's side is tinted", () => {
            const { container } = render(
                <SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={{ a: false, b: true }} />,
            );
            load(container, B);

            const wash = screen.getByTestId("mark-wash");
            const layerA = screen.getByTestId("slider-a");
            expect(picture(container, B).parentElement).toContainElement(wash);
            expect(layerA).not.toContainElement(wash);
            expect(wash.compareDocumentPosition(layerA) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(wash).toHaveClass("pointer-events-none");
        });

        it("still moves the handle with the keys while a tag shows", () => {
            const onChange = vi.fn();
            render(<Stateful onChange={onChange} marked={{ a: true, b: false }} />);

            fireEvent.keyDown(slider(), { key: "Home" });
            fireEvent.keyDown(slider(), { key: "ArrowRight" });

            expect(onChange.mock.calls).toEqual([[0], [1]]);
            expect(tag("a")).toBeInTheDocument();
        });
    });
});
