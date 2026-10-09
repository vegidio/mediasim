/** A tile's place on screen, as `getBoundingClientRect()` measures its thumbnail. */
export type TileBox = {
    path: string;
    top: number;
    bottom: number;
    left: number;
    right: number;
};

/**
 * The path `delta` places away from `path` in `paths`, every group's files in screen order, or `undefined` past either
 * end: moving never wraps.
 */
export const stepFlat = (paths: readonly string[], path: string, delta: number) => {
    const index = paths.indexOf(path);
    return index < 0 ? undefined : paths[index + delta];
};

/** The horizontal centre of `box`. */
const centre = (box: TileBox) => (box.left + box.right) / 2;

/**
 * The path of the tile shown below (`"down"`) or above (`"up"`) the one at `path`, among `boxes` in screen order: of
 * the tiles wholly past its edge, those of the nearest row, and of them the one whose centre is horizontally closest
 * to its own, the earlier one on a tie. `undefined` with none.
 */
export const stepVertical = (boxes: readonly TileBox[], path: string, direction: "up" | "down") => {
    const from = boxes.find((box) => box.path === path);
    if (!from) return;

    // How far each tile lies past the selected one's edge, in the direction of the move.
    const gap = (box: TileBox) => (direction === "down" ? box.top - from.bottom : from.top - box.bottom);
    const past = boxes.filter((box) => gap(box) >= 0);
    if (past.length === 0) return;

    const nearest = Math.min(...past.map(gap));
    const row = past.filter((box) => gap(box) === nearest);
    const x = centre(from);

    // `reduce` keeps the earlier box on a tie, since it only replaces on a strictly closer one.
    return row.reduce((best, box) => (Math.abs(centre(box) - x) < Math.abs(centre(best) - x) ? box : best)).path;
};
