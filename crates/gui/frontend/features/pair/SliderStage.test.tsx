import { act, type ReactNode, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaFile } from "@/ipc/thumbs";
import type { Slot } from "@/lib/slots";
import { SliderStage } from "./SliderStage";

vi.mock("@/ipc/thumbs", () => ({
    renditionUrl: (identity: string, bound: number) => `thumb://localhost/${identity}?size=${bound}`,
}));
vi.mock("@/ipc/video", () => ({
    videoUrl: (identity: string) => `video://localhost/${identity}`,
    // H.264 and AAC in MP4, which the test setup's `canPlayType` plays directly.
    probeVideo: async () => ({
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: 42,
        video: { codec: "h264", codecString: "avc1.640028", decodable: true },
        audio: { codec: "aac", codecString: "mp4a.40.2", decodable: true },
    }),
    // A remux and a transcode, which an error before the first frame falls back to, fail too: these files can't be
    // played at all.
    videoOpen: vi.fn(async () => {
        throw { kind: "unreadable", message: "not a video" };
    }),
    videoNext: vi.fn(),
    videoClose: vi.fn(async () => {}),
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
    bar,
    onChange,
}: {
    a?: MediaFile;
    b?: MediaFile;
    marked?: Record<Slot, boolean>;
    bar?: ReactNode;
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
            bar={bar}
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
    it.each([
        [{ a: "trash", b: "trash" }, "Both files moved to Trash"],
        [{ a: "permanent", b: "permanent" }, "Both files deleted"],
        [{ a: "trash", b: "permanent" }, "Both files removed"],
    ] as const)("reads, with both files gone as %o, %s", (gone, line) => {
        render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} gone={gone} />);

        expect(stage()).toHaveTextContent(new RegExp(`^${line}$`));
        expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });

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

    describe("media and bar", () => {
        const VID_A = media("VID_0714.mov", "video");
        const VID_B = media("VID_0714-edit.mov", "video");
        const MEDIA = { a: <i data-testid="media-a" />, b: <i data-testid="media-b" /> };
        const bar = () => screen.getByTestId("slider-bar");
        /** `value` as the style declaration serialises it, which reorders and simplifies math. */
        const serialised = (property: string, value: string) => {
            const probe = document.createElement("div");
            probe.style.setProperty(property, value);
            return probe.style.getPropertyValue(property);
        };
        const loadSized = (container: HTMLElement, file: MediaFile, width: number, height: number) => {
            Object.defineProperty(picture(container, file), "naturalWidth", { value: width });
            Object.defineProperty(picture(container, file), "naturalHeight", { value: height });
            load(container, file);
        };

        it("draws A's media inside its clipped layer and B's outside it, each in its own picture", () => {
            const { container } = render(
                <SliderStage
                    a={VID_A}
                    b={VID_B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    media={MEDIA}
                />,
            );

            const layerA = screen.getByTestId("slider-a");
            expect(layerA).toContainElement(screen.getByTestId("media-a"));
            expect(layerA).not.toContainElement(screen.getByTestId("media-b"));
            expect(picture(container, VID_A).parentElement).toContainElement(screen.getByTestId("media-a"));
            expect(picture(container, VID_B).parentElement).toContainElement(screen.getByTestId("media-b"));
            expect(stage()).toHaveClass("[container-type:size]");
        });

        it("still washes each marked side over its media", () => {
            const { container } = render(
                <SliderStage
                    a={VID_A}
                    b={VID_B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={{ a: true, b: true }}
                    media={MEDIA}
                />,
            );
            load(container, VID_A);
            load(container, VID_B);

            const [washB, washA] = screen.getAllByTestId("mark-wash");
            expect(screen.getByTestId("media-a").compareDocumentPosition(washA as HTMLElement)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(screen.getByTestId("media-b").compareDocumentPosition(washB as HTMLElement)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(screen.getByTestId("slider-a")).toContainElement(washA as HTMLElement);
        });

        it("draws the bar last, after the handle's root and the tags", () => {
            render(
                <SliderStage
                    a={VID_A}
                    b={VID_B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={{ a: true, b: true }}
                    bar={<i data-testid="bar" />}
                />,
            );

            expect(stage().lastElementChild).toBe(bar());
            expect(bar()).toContainElement(screen.getByTestId("bar"));
            expect(slider().compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("doesn't move the handle when the bar is pressed", () => {
            const onChange = vi.fn();
            render(
                <Stateful a={VID_A} b={VID_B} bar={<button type="button">Play A and B</button>} onChange={onChange} />,
            );

            // The handle's root, which reads a press against its own box; jsdom lays nothing out and has no pointer
            // capture. Laid out, a press on it moves the handle, so the bar's press below is a fair test.
            const root = slider().closest(".cursor-ew-resize") as HTMLElement;
            root.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 300 });
            root.setPointerCapture = () => {};
            const play = screen.getByRole("button", { name: "Play A and B" });

            fireEvent.pointerDown(play, { clientX: 100, pointerId: 1 });
            fireEvent.click(play);

            expect(onChange).not.toHaveBeenCalled();
            expect(slider()).toHaveAttribute("aria-valuenow", "50");

            fireEvent.pointerDown(root, { clientX: 100, pointerId: 1 });

            expect(onChange).toHaveBeenCalledExactlyOnceWith(25);
        });

        it("sits the bar along the stage's bottom until a picture's shape is known", () => {
            render(
                <SliderStage
                    a={VID_A}
                    b={VID_B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    bar={<i />}
                />,
            );

            expect(bar().style.width).toBe("");
            expect(bar().style.bottom).toBe("");
            expect(bar()).toHaveClass("absolute", "bottom-3", "w-[max(calc(100%-24px),min(280px,100%))]");
        });

        it("fits the bar to the one known shape", () => {
            const { container } = render(
                <SliderStage
                    a={VID_A}
                    b={VID_B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    bar={<i />}
                />,
            );

            loadSized(container, VID_B, 1920, 1080);

            const ratio = 1920 / 1080;
            expect(bar().style.width).toBe(
                serialised("width", `clamp(min(280px, 100cqw), min(100cqw, ${ratio} * 100cqh) - 24px, 100cqw)`),
            );
            expect(bar().style.bottom).toBe(
                serialised("bottom", `calc((100cqh - min(100cqh, 100cqw / ${ratio})) / 2 + 12px)`),
            );
        });

        it("fits the bar to the wider picture's width and the taller picture's bottom edge", () => {
            const { container } = render(
                <SliderStage
                    a={VID_A}
                    b={VID_B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    bar={<i />}
                />,
            );

            loadSized(container, VID_A, 1080, 1920);
            loadSized(container, VID_B, 1920, 1080);

            const wide = 1920 / 1080;
            const tall = 1080 / 1920;
            expect(bar().style.width).not.toBe("");
            expect(bar().style.width).toBe(
                serialised("width", `clamp(min(280px, 100cqw), min(100cqw, ${wide} * 100cqh) - 24px, 100cqw)`),
            );
            expect(bar().style.bottom).toBe(
                serialised("bottom", `calc((100cqh - min(100cqh, 100cqw / ${tall})) / 2 + 12px)`),
            );
        });

        it("draws no bar box without a bar", () => {
            render(<SliderStage a={A} b={B} position={50} onPositionChange={() => {}} marked={UNMARKED} />);

            expect(screen.queryByTestId("slider-bar")).not.toBeInTheDocument();
        });
    });

    describe("lone file", () => {
        const VIDEO = media("VID_0714.mov", "video");

        it("gives a remaining video its own player, which plays it alone", async () => {
            const { container } = render(
                <SliderStage
                    a={VIDEO}
                    b={B}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    gone={{ b: "trash" }}
                />,
            );
            await act(async () => {});

            const videos = container.querySelectorAll("video");
            expect(videos).toHaveLength(1);
            expect(videos[0]).toHaveAttribute("src", "video://localhost/id-VID_0714.mov");
            expect(screen.getByRole("group", { name: "Player for VID_0714.mov" })).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "Play VID_0714.mov" }));

            expect((videos[0] as HTMLVideoElement).paused).toBe(false);
            expect(screen.queryByRole("slider", { name: "Drag to compare A and B" })).not.toBeInTheDocument();
        });

        it("washes a marked remaining video", () => {
            const { container } = render(
                <SliderStage
                    a={A}
                    b={VIDEO}
                    position={50}
                    onPositionChange={() => {}}
                    marked={{ a: false, b: true }}
                    gone={{ a: "permanent" }}
                />,
            );
            load(container, VIDEO);

            const wash = screen.getByTestId("mark-wash");
            expect((container.querySelector("video") as HTMLVideoElement).compareDocumentPosition(wash)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
            expect(screen.getByTestId("delete-tag-b")).toBeInTheDocument();
        });

        it("gives a remaining image no player", () => {
            const { container } = render(
                <SliderStage
                    a={A}
                    b={VIDEO}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    gone={{ b: "trash" }}
                />,
            );

            expect(container.querySelector("video")).not.toBeInTheDocument();
            expect(screen.queryByRole("group")).not.toBeInTheDocument();
        });

        it("gives no player when both are gone", () => {
            const { container } = render(
                <SliderStage
                    a={VIDEO}
                    b={VIDEO}
                    position={50}
                    onPositionChange={() => {}}
                    marked={UNMARKED}
                    gone={{ a: "trash", b: "trash" }}
                />,
            );

            expect(container.querySelector("video")).not.toBeInTheDocument();
            expect(screen.queryByRole("group")).not.toBeInTheDocument();
        });
    });
});
