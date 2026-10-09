import { act } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { tileOffset } from "./layout";
import { REORDER_MS, useReorderAnimation } from "./useReorderAnimation";

/** An animation `Element.animate` gave, whose end the test decides. */
type FakeAnimation = { element: Element; from: string; to: string; cancel: Mock; finish: () => Promise<void> };

let animations: FakeAnimation[] = [];

/** The animations started on the tile keyed `key`, in order. */
const animationsOf = (key: string) => animations.filter(({ element }) => element === screen.getByTestId(key));

const translate = ({ x, y }: { x: number; y: number }) => `translate(${x}px, ${y}px)`;

/** A scroller `height` px tall, scrolled `scrollTop` px down. */
const scrollerOf = (height: number, scrollTop = 0) => {
    const element = document.createElement("div");
    Object.defineProperty(element, "clientHeight", { value: height });
    element.scrollTop = scrollTop;
    return element;
};

type HarnessProps = {
    arrangement?: string;
    keys: string[];
    columns?: number;
    /** The keys rendered in view; every key by default. */
    shown?: string[];
    viewTop?: number;
    scroller: HTMLElement;
};

/** Tiles keyed and rendered as the grid does, with the ones sliding out marked. */
const Harness = ({ arrangement, keys, columns = 2, shown = keys, viewTop = 0, scroller }: HarnessProps) => {
    const { departing, track } = useReorderAnimation({
        ...(arrangement !== undefined && { arrangement }),
        tiles: keys,
        keyOf: (key) => key,
        columns,
        shown: new Set(shown),
        viewTop,
        scroller,
    });

    return (
        <>
            {shown.map((key) => (
                <div key={key} ref={track} data-key={key} data-testid={key} />
            ))}
            {departing.map(({ key }) => (
                <div key={key} ref={track} data-key={key} data-testid={key} data-departing="" />
            ))}
        </>
    );
};

beforeEach(() => {
    animations = [];
    Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        value: vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
            expect(options).toMatchObject({ duration: REORDER_MS });
            let finish = () => {};
            const finished = new Promise<void>((resolve) => {
                finish = resolve;
            });
            const animation: FakeAnimation = {
                element: this,
                from: String(keyframes[0]?.transform),
                to: String(keyframes[1]?.transform),
                cancel: vi.fn(),
                finish: async () => {
                    finish();
                    await finished;
                },
            };
            animations.push(animation);
            return { finished, cancel: animation.cancel };
        }),
    });
});

afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
});

describe("useReorderAnimation", () => {
    it("slides each tile from its old place to its new one, and scrolls to the top", () => {
        const scroller = scrollerOf(600, 0);
        const { rerender } = render(<Harness arrangement="both" keys={["a", "b", "c", "d"]} scroller={scroller} />);
        expect(animations).toHaveLength(0);

        rerender(<Harness arrangement="videos" keys={["b", "d", "a", "c"]} scroller={scroller} />);

        const slid = (key: string, was: number, now: number) =>
            expect(animationsOf(key)).toMatchObject([
                { from: translate(tileOffset(was, 2)), to: translate(tileOffset(now, 2)) },
            ]);
        slid("a", 0, 2);
        slid("b", 1, 0);
        slid("c", 2, 3);
        slid("d", 3, 1);
        expect(scroller.scrollTop).toBe(0);
    });

    it("slides a far tile in from just below the view", () => {
        const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
        const scroller = scrollerOf(400);
        const { rerender } = render(
            <Harness arrangement="both" keys={keys} shown={keys.slice(0, 4)} scroller={scroller} />,
        );

        const moved = ["k19", ...keys.slice(0, 19)];
        rerender(<Harness arrangement="images" keys={moved} shown={moved.slice(0, 4)} scroller={scroller} />);

        // 9 rows down, at the second column, it starts at the view's bottom edge instead.
        expect(animationsOf("k19")).toMatchObject([
            { from: translate({ x: tileOffset(19, 2).x, y: 400 }), to: translate(tileOffset(0, 2)) },
        ]);
    });

    it("waits for the scroll to reach the top before sliding the tiles shown there", () => {
        const scroller = scrollerOf(600, 2000);
        const { rerender } = render(
            <Harness arrangement="both" keys={["a", "b", "c"]} viewTop={2000} scroller={scroller} />,
        );

        rerender(<Harness arrangement="images" keys={["a", "c", "b"]} viewTop={2000} scroller={scroller} />);
        expect(scroller.scrollTop).toBe(0);
        expect(animations).toHaveLength(0);

        rerender(<Harness arrangement="images" keys={["a", "c", "b"]} viewTop={0} scroller={scroller} />);
        expect(animationsOf("c")).toMatchObject([
            { from: translate(tileOffset(2, 2)), to: translate(tileOffset(1, 2)) },
        ]);
    });

    it("doesn't slide on the first render, a resize or a new read of the tiles", () => {
        const scroller = scrollerOf(600, 300);
        const { rerender } = render(<Harness arrangement="images" keys={["a", "b", "c"]} scroller={scroller} />);

        rerender(<Harness arrangement="images" keys={["a", "b", "c"]} columns={3} scroller={scroller} />);
        rerender(<Harness arrangement="images" keys={["c", "a", "b", "d"]} columns={3} scroller={scroller} />);

        expect(animations).toHaveLength(0);
        expect(scroller.scrollTop).toBe(300);
    });

    it("moves the tiles at once, still scrolling to the top, when the system asks for reduced motion", () => {
        vi.spyOn(window, "matchMedia").mockImplementation(
            (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) as MediaQueryList,
        );
        const scroller = scrollerOf(600, 300);
        const { rerender } = render(
            <Harness arrangement="both" keys={["a", "b", "c", "d"]} shown={["a", "b"]} scroller={scroller} />,
        );

        rerender(<Harness arrangement="videos" keys={["b", "d", "a", "c"]} shown={["b", "d"]} scroller={scroller} />);

        expect(animations).toHaveLength(0);
        expect(screen.queryByTestId("a")).not.toBeInTheDocument();
        expect(scroller.scrollTop).toBe(0);
    });

    describe("tiles leaving the view", () => {
        it("keep rendering, sliding out past the bottom edge, until their animation finishes", async () => {
            // One row in view: the tiles 24 px down, and the next row's at 188 px, below the view's 100 px.
            const scroller = scrollerOf(100);
            const { rerender } = render(<Harness arrangement="both" keys={["a", "b", "c", "d"]} scroller={scroller} />);

            rerender(
                <Harness arrangement="videos" keys={["b", "d", "a", "c"]} shown={["b", "d"]} scroller={scroller} />,
            );

            expect(screen.getByTestId("a")).toHaveAttribute("data-departing");
            expect(animationsOf("a")).toMatchObject([
                { from: translate(tileOffset(0, 2)), to: translate({ x: tileOffset(2, 2).x, y: 100 }) },
            ]);
            // Below the view before and after, so it has nothing to show sliding, and is dropped at once.
            expect(screen.queryByTestId("c")).not.toBeInTheDocument();

            const [slide] = animationsOf("a");
            await act(async () => slide?.finish());

            expect(screen.queryByTestId("a")).not.toBeInTheDocument();
            expect(screen.getByTestId("b")).toBeInTheDocument();
        });
    });

    it("starts another change's slide from where each tile is shown partway through the last one", () => {
        const scroller = scrollerOf(600);
        const { rerender } = render(<Harness arrangement="both" keys={["a", "b", "c", "d"]} scroller={scroller} />);
        rerender(<Harness arrangement="videos" keys={["b", "d", "a", "c"]} scroller={scroller} />);
        const [first] = animationsOf("b");

        // Halfway from its place in the first row's second column to the first column.
        const style = getComputedStyle;
        vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
            element === screen.getByTestId("b")
                ? ({ transform: "matrix(1, 0, 0, 1, 86, 24)" } as CSSStyleDeclaration)
                : style(element),
        );
        rerender(<Harness arrangement="images" keys={["a", "c", "b", "d"]} scroller={scroller} />);

        expect(first?.cancel).toHaveBeenCalledOnce();
        expect(animationsOf("b").at(-1)).toMatchObject({
            from: translate({ x: 86, y: 24 }),
            to: translate(tileOffset(2, 2)),
        });
    });
});
