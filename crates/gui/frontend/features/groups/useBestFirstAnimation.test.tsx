import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REORDER_MS } from "@/features/gallery/useReorderAnimation";
import { useBestFirstAnimation } from "./useBestFirstAnimation";

/** How far apart the tiles are laid, in px, one after another along a row. */
const STEP = 100;

type FakeAnimation = { element: Element; from: string; to: string; cancel: () => void };

let animations: FakeAnimation[] = [];

/** The animations started on the tile of `path`, in order. */
const animationsOf = (path: string) => animations.filter(({ element }) => element === screen.getByTestId(path));

/** Tiles laid out as a group card lays its files, the first one its best. */
const Harness = ({ paths, arrangement = "row" }: { paths: string[]; arrangement?: string }) => {
    const tiles = useBestFirstAnimation(arrangement, paths[0]);

    return (
        <div ref={tiles}>
            {paths.map((path) => (
                <div key={path} data-path={path} data-testid={path} />
            ))}
        </div>
    );
};

beforeEach(() => {
    animations = [];
    // jsdom lays nothing out: each tile is placed by its place among its siblings, the container at the origin.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
        const left = this instanceof HTMLElement && this.dataset.path ? index * STEP : 0;
        return DOMRect.fromRect({ x: left, y: 0, width: STEP, height: STEP });
    });
    Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        value: vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
            expect(options).toMatchObject({ duration: REORDER_MS });
            const animation = {
                element: this,
                from: String(keyframes[0]?.transform),
                to: String(keyframes[1]?.transform),
                cancel: vi.fn(),
            };
            animations.push(animation);
            return { finished: new Promise(() => {}), cancel: animation.cancel };
        }),
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (Element.prototype as Partial<Element>).animate;
});

describe("useBestFirstAnimation", () => {
    it("slides the new best file to the front and the files it passes one place along", () => {
        const { rerender } = render(<Harness paths={["a", "b", "c"]} />);
        expect(animations).toHaveLength(0);

        rerender(<Harness paths={["c", "a", "b"]} />);

        expect(animationsOf("c")).toMatchObject([{ from: `translate(${2 * STEP}px, 0px)`, to: "none" }]);
        expect(animationsOf("a")).toMatchObject([{ from: `translate(${-STEP}px, 0px)`, to: "none" }]);
        expect(animationsOf("b")).toMatchObject([{ from: `translate(${-STEP}px, 0px)`, to: "none" }]);
        expect(screen.getByTestId("c").style.zIndex).toBe("1");
    });

    it("doesn't slide when the best file stays", () => {
        const { rerender } = render(<Harness paths={["a", "b", "c"]} />);

        rerender(<Harness paths={["a", "c"]} />);

        expect(animations).toHaveLength(0);
    });

    it("doesn't slide when the layout changes along with the best file", () => {
        const { rerender } = render(<Harness paths={["a", "b"]} />);

        rerender(<Harness paths={["b", "a"]} arrangement="list" />);

        expect(animations).toHaveLength(0);
    });

    it("doesn't slide when the system asks for reduced motion", () => {
        vi.spyOn(window, "matchMedia").mockImplementation(
            (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) as MediaQueryList,
        );
        const { rerender } = render(<Harness paths={["a", "b"]} />);

        rerender(<Harness paths={["b", "a"]} />);

        expect(animations).toHaveLength(0);
    });

    it("cancels the slides still running when the best file changes again", () => {
        const { rerender } = render(<Harness paths={["a", "b", "c"]} />);
        rerender(<Harness paths={["c", "a", "b"]} />);
        const first = [...animations];

        rerender(<Harness paths={["b", "c", "a"]} />);

        for (const animation of first) expect(animation.cancel).toHaveBeenCalled();
        expect(screen.getByTestId("c").style.zIndex).toBe("");
        expect(screen.getByTestId("b").style.zIndex).toBe("1");
    });
});
