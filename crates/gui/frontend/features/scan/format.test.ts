import { describe, expect, it } from "vitest";
import { formatKinds, formatTimeLeft, formatUnreadable, percentDone } from "./format";

describe("formatTimeLeft", () => {
    it.each([
        [undefined, "Estimating time left"],
        [0, "Almost done"],
        [24, "About 24 s left"],
        [0.2, "About 1 s left"],
        [23.1, "About 24 s left"],
        [59.5, "About 1 min left"],
        [60, "About 1 min left"],
        [61, "About 2 min left"],
        [3540, "About 59 min left"],
        [3541, "About 1 h 0 min left"],
        [3600, "About 1 h 0 min left"],
        [3601, "About 1 h 1 min left"],
        [7380, "About 2 h 3 min left"],
    ])("reads %s seconds as %s", (seconds, text) => {
        expect(formatTimeLeft(seconds)).toBe(text);
    });
});

describe("formatKinds", () => {
    it.each([
        ["both", "images and videos"],
        ["images", "images"],
        ["videos", "videos"],
    ] as const)("names %s as %s", (kinds, text) => {
        expect(formatKinds(kinds)).toBe(text);
    });
});

describe("formatUnreadable", () => {
    it("counts one file in the singular and more in the plural", () => {
        expect(formatUnreadable(1)).toBe("1 file couldn't be read");
        expect(formatUnreadable(3)).toBe("3 files couldn't be read");
    });
});

describe("percentDone", () => {
    it("rounds down, so it reads 100 only when every file is done", () => {
        expect(percentDone(30, 48)).toBe(62);
        expect(percentDone(47, 48)).toBe(97);
        expect(percentDone(199, 200)).toBe(99);
        expect(percentDone(48, 48)).toBe(100);
        expect(percentDone(0, 48)).toBe(0);
    });
});
