import { describe, expect, it } from "vitest";
import { isArrow, move } from "./navigate";

/** The 1-based tile `key` selects from the `nth` tile, as the spec's scenarios count. */
const from = (nth: number, key: Parameters<typeof move>[0], count: number, columns: number) =>
    move(key, nth - 1, count, columns) + 1;

describe("move", () => {
    it("goes right across a row's end", () => {
        expect(from(7, "ArrowRight", 48, 7)).toBe(8);
    });

    it("goes left across a row's start", () => {
        expect(from(8, "ArrowLeft", 48, 7)).toBe(7);
    });

    it("doesn't wrap at the very ends", () => {
        expect(from(48, "ArrowRight", 48, 7)).toBe(48);
        expect(from(1, "ArrowLeft", 48, 7)).toBe(1);
    });

    it("keeps the column going up and down", () => {
        expect(from(10, "ArrowUp", 48, 7)).toBe(3);
        expect(from(3, "ArrowDown", 48, 7)).toBe(10);
    });

    it("goes down to the last tile of a shorter row with no tile in that column", () => {
        expect(from(6, "ArrowDown", 10, 7)).toBe(10);
        expect(from(3, "ArrowDown", 10, 7)).toBe(10);
        expect(from(2, "ArrowDown", 10, 7)).toBe(9);
    });

    it("does nothing going up on the first row, or down on the last", () => {
        expect(from(4, "ArrowUp", 48, 7)).toBe(4);
        expect(from(45, "ArrowDown", 48, 7)).toBe(45);
        expect(from(9, "ArrowDown", 10, 7)).toBe(9);
    });

    it("follows the columns of each call", () => {
        expect(from(7, "ArrowDown", 48, 7)).toBe(14);
        expect(from(7, "ArrowDown", 48, 8)).toBe(15);
    });

    it("stays put with a single column's ends, and a single tile", () => {
        expect(from(1, "ArrowUp", 3, 1)).toBe(1);
        expect(from(1, "ArrowDown", 3, 1)).toBe(2);
        for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const)
            expect(from(1, key, 1, 7)).toBe(1);
    });
});

describe("isArrow", () => {
    it("knows the four arrow keys, and nothing else", () => {
        expect(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].every(isArrow)).toBe(true);
        expect(isArrow("Enter")).toBe(false);
        expect(isArrow(" ")).toBe(false);
    });
});
