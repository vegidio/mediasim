/** How many files the dialog's filmstrip shows at most. */
export const STRIP_SIZE = 7;

/** The index of the file at `path` among `files`, or `-1` when it isn't one of them. */
export const indexOfPath = (files: readonly { path: string }[], path: string) =>
    files.findIndex((file) => file.path === path);

/** The position of the file at `index` among `count` files, counted from one: `4 of 48`. */
export const position = (index: number, count: number) => `${index + 1} of ${count}`;

/** The file before the one at `index`, or `undefined` on the first: moving never wraps. */
export const previousOf = <T>(files: readonly T[], index: number) => (index > 0 ? files[index - 1] : undefined);

/** The file after the one at `index`, or `undefined` on the last: moving never wraps. */
export const nextOf = <T>(files: readonly T[], index: number) =>
    index >= 0 && index < files.length - 1 ? files[index + 1] : undefined;

/**
 * The filmstrip's files around the one at `index`, as the half-open range `[start, end)`: up to {@link STRIP_SIZE}
 * of `count` files with `index` in the middle, slid against the start or end of the gallery near either one.
 */
export const stripWindow = (count: number, index: number, size = STRIP_SIZE) => {
    const shown = Math.min(size, count);
    const start = Math.min(Math.max(0, index - Math.floor(shown / 2)), count - shown);

    return { start, end: start + shown };
};
