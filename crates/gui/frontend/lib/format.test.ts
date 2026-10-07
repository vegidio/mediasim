import { describe, expect, it } from "vitest";
import { formatCount, formatCreated, formatDuration, formatFrameRate, formatSize, totalSize } from "./format";

/** An RFC 3339 time for a local wall-clock time, so the expectations hold in any time zone. */
const local = (year: number, month: number, day: number, hours = 0, minutes = 0) =>
    new Date(year, month - 1, day, hours, minutes).toISOString();

describe("formatSize", () => {
    it("shows bytes below 1 kB as they are", () => {
        expect(formatSize(0)).toBe("0 B");
        expect(formatSize(999)).toBe("999 B");
    });

    it("uses decimal units with one decimal place", () => {
        expect(formatSize(1000)).toBe("1.0 kB");
        expect(formatSize(3_100_000)).toBe("3.1 MB");
        expect(formatSize(1_200_000_000)).toBe("1.2 GB");
        expect(formatSize(2_500_000_000_000)).toBe("2.5 TB");
    });

    it("moves to the next unit when rounding would reach 1000", () => {
        expect(formatSize(999_960)).toBe("1.0 MB");
    });
});

describe("formatDuration", () => {
    it.each([
        [0, "0:00"],
        [42.6, "0:42"],
        [59.999, "0:59"],
        [61, "1:01"],
        [3599, "59:59"],
        [3600, "1:00:00"],
        [3725, "1:02:05"],
    ])("reads %d seconds as %s", (seconds, expected) => {
        expect(formatDuration(seconds)).toBe(expected);
    });
});

describe("formatCount", () => {
    it("reads 1 file in the singular", () => {
        expect(formatCount(1)).toBe("1 file");
    });

    it("reads every other count in the plural", () => {
        expect(formatCount(0)).toBe("0 files");
        expect(formatCount(48)).toBe("48 files");
    });
});

describe("totalSize", () => {
    it("adds up the files' sizes, and is 0 for none", () => {
        expect(totalSize([])).toBe(0);
        expect(totalSize([{ size: 1000 }, { size: 234 }])).toBe(1234);
    });
});

describe("formatFrameRate", () => {
    it.each([
        [30000 / 1001, "29.97 fps"],
        [30, "30 fps"],
        [24000 / 1001, "23.98 fps"],
        [12.5, "12.5 fps"],
        [60.001, "60 fps"],
    ])("reads %d as %s", (fps, expected) => {
        expect(formatFrameRate(fps)).toBe(expected);
    });
});

describe("formatCreated", () => {
    it("shows the local time as YYYY-MM-DD HH:MM", () => {
        expect(formatCreated(local(2025, 7, 14, 20, 41))).toBe("2025-07-14 20:41");
        expect(formatCreated(local(2026, 1, 5, 3, 7))).toBe("2026-01-05 03:07");
    });
});
