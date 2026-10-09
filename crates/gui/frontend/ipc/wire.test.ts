import { describe, expect, it } from "vitest";
import { withoutNulls } from "./wire";

describe("withoutNulls", () => {
    it("leaves out each null property and keeps every other, falsy ones included", () => {
        const wire: { path: string; size: number; duration: number | null; created: string | null; flag: boolean } = {
            path: "/a.mov",
            size: 0,
            duration: null,
            created: "",
            flag: false,
        };

        const value = withoutNulls(wire);

        expect(value).toEqual({ path: "/a.mov", size: 0, created: "", flag: false });
        expect(value).not.toHaveProperty("duration");
    });

    it("returns a new object, leaving the one given as it was", () => {
        const wire = { a: 1, b: null };

        expect(withoutNulls(wire)).not.toBe(wire);
        expect(wire).toEqual({ a: 1, b: null });
    });
});
