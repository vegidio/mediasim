/** The keys that move the selection through the grid. */
export type Arrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** Whether `key` is one of the {@link Arrow} keys. */
export const isArrow = (key: string): key is Arrow =>
    key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";

/**
 * The index of the tile `key` selects from the one at `index`, among `count` tiles in `columns` columns. ← and → follow
 * the gallery's order across rows, and stop at its ends. ↑ and ↓ keep the column, and stop on the first and last rows;
 * ↓ into a shorter last row with no tile in that column selects its last tile.
 */
export const move = (key: Arrow, index: number, count: number, columns: number) => {
    switch (key) {
        case "ArrowLeft":
            return Math.max(index - 1, 0);
        case "ArrowRight":
            return Math.min(index + 1, count - 1);
        case "ArrowUp":
            return index >= columns ? index - columns : index;
        case "ArrowDown":
            return Math.floor(index / columns) < Math.floor((count - 1) / columns)
                ? Math.min(index + columns, count - 1)
                : index;
    }
};
