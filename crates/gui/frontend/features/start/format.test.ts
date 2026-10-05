import { describe, expect, it } from "vitest";
import { formatCount } from "./format";

describe("formatCount", () => {
    it("reads 1 file in the singular", () => {
        expect(formatCount(1)).toBe("1 file");
    });

    it("reads every other count in the plural", () => {
        expect(formatCount(0)).toBe("0 files");
        expect(formatCount(48)).toBe("48 files");
    });
});
