import { describe, expect, it } from "vitest";
import { formatDuration, formatSize } from "./format";

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
