import { describe, expect, it } from "vitest";
import { route, type Slot } from "./routePairDrop";

const EMPTY = { a: false, b: false };
const ONLY_A = { a: true, b: false };
const ONLY_B = { a: false, b: true };
const FULL = { a: true, b: true };

describe("route", () => {
    it.each<[string, number, Slot | undefined, { a: boolean; b: boolean }, Slot[]]>([
        ["no file onto a slot", 0, "a", EMPTY, []],
        ["no file onto the card", 0, undefined, EMPTY, []],
        ["one file onto empty A", 1, "a", EMPTY, ["a"]],
        ["one file onto filled A", 1, "a", FULL, ["a"]],
        ["one file onto empty B", 1, "b", EMPTY, ["b"]],
        ["one file onto filled B", 1, "b", FULL, ["b"]],
        ["one file onto the card, both empty", 1, undefined, EMPTY, ["a"]],
        ["one file onto the card, A empty", 1, undefined, ONLY_B, ["a"]],
        ["one file onto the card, only B empty", 1, undefined, ONLY_A, ["b"]],
        ["one file onto the card, both filled", 1, undefined, FULL, []],
        ["two files onto A", 2, "a", EMPTY, ["a", "b"]],
        ["two files onto B", 2, "b", ONLY_A, ["a", "b"]],
        ["two files onto the card", 2, undefined, FULL, ["a", "b"]],
        ["three files onto A", 3, "a", FULL, ["a", "b"]],
        ["three files onto B", 3, "b", EMPTY, ["a", "b"]],
        ["three files onto the card", 3, undefined, ONLY_B, ["a", "b"]],
    ])("%s", (_, count, target, filled, slots) => {
        expect(route(count, target, filled)).toEqual(slots);
    });
});
