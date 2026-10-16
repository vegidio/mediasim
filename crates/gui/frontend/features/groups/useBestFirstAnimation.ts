import { useLayoutEffect, useRef } from "react";
import type { Offset } from "@/features/gallery/layout";
import { EASING, prefersReducedMotion, REORDER_MS } from "@/features/gallery/useReorderAnimation";

/** The tiles in `container`, by the path in their `data-path`. */
const tilesOf = (container: HTMLElement) =>
    new Map(
        [...container.querySelectorAll<HTMLElement>(":scope > [data-path]")].map((tile) => [
            tile.dataset.path ?? "",
            tile,
        ]),
    );

/** Where each tile in `container` is shown, partway through a slide included, relative to the container. */
const placesOf = (container: HTMLElement) => {
    const origin = container.getBoundingClientRect();
    const places = new Map<string, Offset>();
    for (const [path, tile] of tilesOf(container)) {
        const { left, top } = tile.getBoundingClientRect();
        places.set(path, { x: left - origin.left, y: top - origin.top });
    }
    return places;
};

/**
 * Slides a group's tiles to their new places when its best file, shown first, changes: the best file to the front and
 * the files it passes one place along. Returns the ref of the element holding the tiles, each of which must carry its
 * file's path in `data-path`. Nothing slides when `arrangement`, such as the layout, changes in the same render, nor
 * when the system asks for reduced motion.
 */
export const useBestFirstAnimation = (arrangement: string, best?: string) => {
    // It measures the tiles while rendering, before the new order reaches the page, which the compiler can't follow.
    "use no memo";

    const container = useRef<HTMLDivElement>(null);
    const committed = useRef<{ best?: string; arrangement: string }>(undefined);
    /** Where every tile was shown before the best file changed, waiting for the commit to slide them from. */
    const before = useRef<Map<string, Offset>>(undefined);
    const running = useRef(new Map<HTMLElement, Animation>());

    const last = committed.current;
    if (
        last &&
        last.best !== best &&
        last.arrangement === arrangement &&
        container.current &&
        !prefersReducedMotion()
    ) {
        before.current = placesOf(container.current);
    }

    useLayoutEffect(() => {
        committed.current = { ...(best && { best }), arrangement };
        const from = before.current;
        before.current = undefined;
        if (!from || !container.current) return;

        // Each tile still sliding goes on from where it was shown, which `from` holds, so its slide ends here.
        for (const [tile, animation] of running.current) {
            animation.cancel();
            tile.style.zIndex = "";
        }
        running.current.clear();

        const to = placesOf(container.current);
        for (const [path, tile] of tilesOf(container.current)) {
            const start = from.get(path);
            const end = to.get(path);
            if (!start || !end || (start.x === end.x && start.y === end.y)) continue;

            // The best file passes over the files it moves ahead of.
            const front = path === best;
            if (front) tile.style.zIndex = "1";
            const animation = tile.animate(
                [{ transform: `translate(${start.x - end.x}px, ${start.y - end.y}px)` }, { transform: "none" }],
                { duration: REORDER_MS, easing: EASING },
            );
            running.current.set(tile, animation);

            // A slide cancelled by the next change leaves the tile to that one.
            const settle = () => {
                if (running.current.get(tile) !== animation) return;
                running.current.delete(tile);
                tile.style.zIndex = "";
            };
            animation.finished.then(settle, settle);
        }
    });

    return container;
};
