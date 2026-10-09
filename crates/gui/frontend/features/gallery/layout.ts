/** A tile's width, in pixels. */
export const TILE_WIDTH = 160;
/** The space between columns, in pixels. */
export const COLUMN_GAP = 12;
/** The space between rows, in pixels. */
export const ROW_GAP = 20;
/** A row's height with the gap below it: the 120 px picture, an 8 px gap, the 16 px name row, then the row gap. */
export const ROW_HEIGHT = 120 + 8 + 16 + ROW_GAP;
/** The grid's padding on every side, in pixels. */
export const PADDING = 24;

/** How many tiles fit across `width` pixels of content, never fewer than one. */
export const columnsFor = (width: number) => Math.max(1, Math.floor((width + COLUMN_GAP) / (TILE_WIDTH + COLUMN_GAP)));

/** The width of a full row of `columns` tiles, in pixels. */
export const rowWidth = (columns: number) => columns * TILE_WIDTH + (columns - 1) * COLUMN_GAP;

/** A translation, in pixels. */
export type Offset = { x: number; y: number };

/**
 * Where the tile at `index` sits among `columns` columns: `x` from the left edge of a full row, which is centred in the
 * grid, and `y` from the top of the grid's content.
 */
export const tileOffset = (index: number, columns: number): Offset => ({
    x: (index % columns) * (TILE_WIDTH + COLUMN_GAP),
    y: PADDING + Math.floor(index / columns) * ROW_HEIGHT,
});
