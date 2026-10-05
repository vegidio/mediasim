import { describe, expect, it } from "vitest";
import { BANDS, band, percent, scoreName } from "./score";

describe("percent", () => {
    it.each([
        [0.94522, 95],
        [0.9487, 95],
        [0.9449, 94],
        [0.285, 29],
        [0.29, 29],
        [0.57, 57],
        [1, 100],
        [0, 0],
        [0.004, 0],
        [0.005, 1],
        [0.995, 100],
        [0.594, 59],
        [0.595, 60],
        [0.895, 90],
    ])("reads %d as %d%%", (similarity, expected) => {
        expect(percent(similarity)).toBe(expected);
    });

    it("stays within 0 and 100", () => {
        expect(percent(1.000_000_1)).toBe(100);
        expect(percent(-0.01)).toBe(0);
    });
});

describe("band", () => {
    it.each([
        [0, "Different"],
        [59, "Different"],
        [60, "Related"],
        [79, "Related"],
        [80, "Similar"],
        [89, "Similar"],
        [90, "Near identical"],
        [94, "Near identical"],
        [100, "Near identical"],
    ])("puts %d%% in %s", (score, name) => {
        expect(band(score).name).toBe(name);
    });

    it("labels the bar's bands in order, sharing all of it", () => {
        expect(BANDS.map(({ label }) => label)).toEqual(["Different", "Related", "Similar", "Near-identical"]);
        expect(BANDS.map(({ share }) => share)).toEqual([60, 20, 10, 10]);
    });
});

describe("scoreName", () => {
    it("calls 100% Identical, still in the Near-identical band", () => {
        expect(scoreName(100)).toBe("Identical");
        expect(band(100).band).toBe("near-identical");
    });

    it.each([
        [99, "Near identical"],
        [90, "Near identical"],
        [85, "Similar"],
        [70, "Related"],
        [10, "Different"],
    ])("calls %d%% by its band, %s", (score, name) => {
        expect(scoreName(score)).toBe(name);
    });
});
