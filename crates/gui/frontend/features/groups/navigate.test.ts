import { describe, expect, it } from "vitest";
import { stepFlat, stepVertical, type TileBox } from "./navigate";

/** Group 1's three files, then Group 2's two, in screen order. */
const PATHS = ["/a/0", "/a/1", "/a/2", "/b/0", "/b/1"];

/** A 160 × 120 px tile at `left`, `top`. */
const tile = (path: string, left: number, top: number): TileBox => ({
    path,
    top,
    bottom: top + 120,
    left,
    right: left + 160,
});

describe("stepFlat", () => {
    it("crosses from a group's last file to the next group's first, and back", () => {
        expect(stepFlat(PATHS, "/a/2", 1)).toBe("/b/0");
        expect(stepFlat(PATHS, "/b/0", -1)).toBe("/a/2");
    });

    it("steps within a group", () => {
        expect(stepFlat(PATHS, "/a/0", 1)).toBe("/a/1");
        expect(stepFlat(PATHS, "/a/1", -1)).toBe("/a/0");
    });

    it("goes nowhere past either end", () => {
        expect(stepFlat(PATHS, "/b/1", 1)).toBeUndefined();
        expect(stepFlat(PATHS, "/a/0", -1)).toBeUndefined();
    });

    it("goes nowhere from a path that isn't there", () => {
        expect(stepFlat(PATHS, "/gone", 1)).toBeUndefined();
    });
});

describe("stepVertical", () => {
    /**
     * Group 1 (3 tiles) and Group 2 (2 tiles) side by side, and Group 3 (3 tiles) on the next line under Group 1. Tiles
     * are 172 px apart, cards 64 px apart, and lines 220 px apart.
     */
    const CARDS = [
        tile("/a/0", 0, 0),
        tile("/a/1", 172, 0),
        tile("/a/2", 344, 0),
        tile("/b/0", 568, 0),
        tile("/b/1", 740, 0),
        tile("/c/0", 0, 220),
        tile("/c/1", 172, 220),
        tile("/c/2", 344, 220),
    ];

    it("picks the horizontally closest tile of the nearest row below, across cards", () => {
        expect(stepVertical(CARDS, "/a/1", "down")).toBe("/c/1");
        // Group 2 has nothing under it, so its tiles go to the closest of Group 3's.
        expect(stepVertical(CARDS, "/b/1", "down")).toBe("/c/2");
    });

    it("picks the horizontally closest tile of the nearest row above", () => {
        expect(stepVertical(CARDS, "/c/2", "up")).toBe("/a/2");
    });

    it("keeps the nearest row only, even with a closer centre further away", () => {
        const boxes = [tile("/a/0", 0, 0), tile("/b/0", 400, 200), tile("/c/0", 0, 400)];

        expect(stepVertical(boxes, "/a/0", "down")).toBe("/b/0");
    });

    it("gives a tie to the earlier file", () => {
        const boxes = [tile("/a/0", 86, 0), tile("/b/0", 0, 200), tile("/b/1", 172, 200)];

        expect(stepVertical(boxes, "/a/0", "down")).toBe("/b/0");
    });

    it("steps within a large group's 8-column grid, from the 3rd file to the 11th", () => {
        const grid = Array.from({ length: 19 }, (_, i) => tile(`/g/${i + 1}`, (i % 8) * 172, Math.floor(i / 8) * 200));

        expect(stepVertical(grid, "/g/3", "down")).toBe("/g/11");
        expect(stepVertical(grid, "/g/11", "up")).toBe("/g/3");
    });

    it("goes nowhere with nothing below or above", () => {
        expect(stepVertical(CARDS, "/c/0", "down")).toBeUndefined();
        expect(stepVertical(CARDS, "/b/0", "up")).toBeUndefined();
    });

    it("goes nowhere from a path that isn't there", () => {
        expect(stepVertical(CARDS, "/gone", "down")).toBeUndefined();
    });
});
