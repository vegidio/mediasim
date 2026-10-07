import { describe, expect, it } from "vitest";
import { indexOfPath, nextOf, position, previousOf, stripWindow } from "./navigate";

/** 48 files, `/f1` to `/f48`, as in the spec's scenarios. */
const FILES = Array.from({ length: 48 }, (_, i) => ({ path: `/f${i + 1}` }));

/** The 1-based numbers of the files a strip window shows. */
const shown = (count: number, nth: number) => {
    const { start, end } = stripWindow(count, nth - 1);
    return Array.from({ length: end - start }, (_, i) => start + i + 1);
};

describe("indexOfPath", () => {
    it("finds a file by path, and nothing for one that isn't there", () => {
        expect(indexOfPath(FILES, "/f4")).toBe(3);
        expect(indexOfPath(FILES, "/gone")).toBe(-1);
    });
});

describe("position", () => {
    it("counts from one", () => {
        expect(position(3, 48)).toBe("4 of 48");
    });
});

describe("moving between files", () => {
    it("steps to the next and previous file", () => {
        expect(nextOf(FILES, 3)).toEqual({ path: "/f5" });
        expect(previousOf(FILES, 3)).toEqual({ path: "/f3" });
    });

    it("stops at either end without wrapping", () => {
        expect(nextOf(FILES, 47)).toBeUndefined();
        expect(previousOf(FILES, 0)).toBeUndefined();
    });

    it("goes nowhere from a file that isn't there", () => {
        expect(nextOf(FILES, -1)).toBeUndefined();
        expect(previousOf(FILES, -1)).toBeUndefined();
    });
});

describe("stripWindow", () => {
    it("keeps the shown file in the middle", () => {
        expect(shown(48, 20)).toEqual([17, 18, 19, 20, 21, 22, 23]);
    });

    it("shows the first 7 near the start", () => {
        expect(shown(48, 2)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(shown(48, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("shows the last 7 near the end", () => {
        expect(shown(48, 47)).toEqual([42, 43, 44, 45, 46, 47, 48]);
        expect(shown(48, 48)).toEqual([42, 43, 44, 45, 46, 47, 48]);
    });

    it("shows every file of a gallery of fewer than 7", () => {
        expect(shown(3, 3)).toEqual([1, 2, 3]);
        expect(shown(1, 1)).toEqual([1]);
    });
});
