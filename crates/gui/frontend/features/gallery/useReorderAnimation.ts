import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { type Offset, ROW_HEIGHT, tileOffset } from "./layout";

/** How long the tiles take to slide to their new places, in milliseconds. */
export const REORDER_MS = 300;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Each tile's index in `tiles`, by key. */
const indexByKey = <T>(tiles: readonly T[], keyOf: (tile: T) => string) =>
    new Map(tiles.map((tile, index) => [keyOf(tile), index]));

const translate = ({ x, y }: Offset) => `translate(${x}px, ${y}px)`;

/** The translation `element` is shown at, partway through an animation included. */
const shownOffset = (element: Element): Offset => {
    const values = /^matrix\((.+)\)$/.exec(getComputedStyle(element).transform)?.[1]?.split(",").map(Number);
    return { x: values?.[4] ?? 0, y: values?.[5] ?? 0 };
};

type ReorderOptions<T> = {
    /**
     * How the tiles are arranged, such as the selected tab. When it changes, the scroller goes back to its top and the
     * tiles slide from their old places to their new ones; when it is `undefined`, they never slide.
     */
    arrangement?: string;
    /** Every tile, in order. */
    tiles: readonly T[];
    keyOf: (tile: T) => string;
    columns: number;
    /** The keys of the tiles rendered in view. */
    shown: ReadonlySet<string>;
    /** Where the rendered view starts, as the tiles in `shown` were chosen for it. */
    viewTop: number;
    scroller?: HTMLElement;
};

/** A tile kept rendered, with its index in `tiles`, while it slides out of view. */
export type Departing<T> = { key: string; tile: T; index: number };

/**
 * Slides tiles placed by index, as {@link tileOffset} places them, to their new places when their arrangement changes.
 * Positions follow from indices, so a tile that wasn't rendered before still slides in from where it was, or from just
 * outside the view when that was far away. Each tile's element must carry its key in `data-key` and the returned
 * `track` as its ref. Tiles that leave the view are returned as `departing`, to render until they have slid out.
 * Nothing slides when the system asks for reduced motion.
 */
export const useReorderAnimation = <T>({
    arrangement,
    tiles,
    keyOf,
    columns,
    shown,
    viewTop,
    scroller,
}: ReorderOptions<T>) => {
    // It reads which tiles are mounted while rendering, to keep them, which the compiler can't follow.
    "use no memo";

    const elements = useRef(new Map<string, HTMLElement>());
    const running = useRef(new Map<string, Animation>());
    /** The arrangement the last commit showed, and the order and columns it showed it in. */
    const committed = useRef<{ arrangement?: string; tiles: readonly T[]; columns: number }>(undefined);
    /** A slide waiting for the view to reach the top, with each key's index before the change. */
    const pending = useRef<{ before: Map<string, number>; columns: number }>(undefined);
    const [seen, setSeen] = useState(arrangement);
    /** The keys of the tiles kept rendered to slide out, with their index in the new order. */
    const [departing, setDeparting] = useState<ReadonlyMap<string, number>>(new Map());

    if (arrangement !== seen) {
        setSeen(arrangement);
        // Every tile on screen stays rendered for now, so the ones the new view leaves out can slide out of it.
        if (seen && arrangement && !prefersReducedMotion()) {
            const after = indexByKey(tiles, keyOf);
            const kept = new Map<string, number>();
            for (const key of elements.current.keys()) {
                const index = after.get(key);
                if (index !== undefined) kept.set(key, index);
            }
            setDeparting(kept);
        }
    }

    const track = useCallback((element: HTMLElement | null) => {
        const key = element?.dataset.key;
        if (!element || !key) return;
        elements.current.set(key, element);
        return () => {
            if (elements.current.get(key) === element) elements.current.delete(key);
        };
    }, []);

    useLayoutEffect(() => {
        const last = committed.current;
        committed.current = { ...(arrangement && { arrangement }), tiles, columns };

        if (last && last.arrangement !== arrangement) {
            if (scroller) scroller.scrollTop = 0;
            const slides = Boolean(last.arrangement && arrangement) && !prefersReducedMotion();
            pending.current = slides ? { before: indexByKey(last.tiles, keyOf), columns: last.columns } : undefined;
        }
        // The view rendered for the old scroll position; the next commit, once the scroll lands, has the top's tiles.
        if (!pending.current || viewTop > 0) return;

        const { before, columns: columnsBefore } = pending.current;
        pending.current = undefined;

        const bottom = scroller?.clientHeight ?? 0;
        const clamp = ({ x, y }: Offset) => ({ x, y: Math.min(Math.max(y, -ROW_HEIGHT), bottom) });
        const outOfView = (from: Offset, to: Offset) =>
            (from.y >= bottom && to.y >= bottom) || (from.y <= -ROW_HEIGHT && to.y <= -ROW_HEIGHT);
        const after = indexByKey(tiles, keyOf);
        const sliding = new Map<string, number>();

        for (const [key, element] of elements.current) {
            const index = after.get(key);
            const was = before.get(key);
            if (index === undefined) continue;

            // A tile still sliding goes on from where it is shown; any other from its old place, near the view.
            const previous = running.current.get(key);
            const from = previous
                ? shownOffset(element)
                : was === undefined
                  ? undefined
                  : clamp(tileOffset(was, columnsBefore));
            previous?.cancel();
            running.current.delete(key);

            const leaving = !shown.has(key);
            const place = tileOffset(index, columns);
            const to = leaving ? clamp(place) : place;
            if (!from || (from.x === to.x && from.y === to.y) || outOfView(from, to)) continue;

            const animation = element.animate([{ transform: translate(from) }, { transform: translate(to) }], {
                duration: REORDER_MS,
                easing: EASING,
            });
            running.current.set(key, animation);
            if (leaving) sliding.set(key, index);

            animation.finished.then(
                () => {
                    if (running.current.get(key) === animation) running.current.delete(key);
                    if (!leaving) return;
                    setDeparting((current) => {
                        if (!current.has(key)) return current;
                        const next = new Map(current);
                        next.delete(key);
                        return next;
                    });
                },
                // Cancelled by the next change, which takes the tile over.
                () => {},
            );
        }

        // The tiles that didn't need to slide out are dropped at once.
        setDeparting(sliding);
    });

    const leaving: Departing<T>[] = [];
    for (const [key, index] of departing) {
        const tile = tiles[index];
        // The tiles may have been read again since; a tile at that index is then another file.
        if (tile !== undefined && !shown.has(key) && keyOf(tile) === key) leaving.push({ key, tile, index });
    }

    return { departing: leaving, track };
};
