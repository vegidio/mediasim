import { describe, expect, it } from "vitest";
import { groupingPhase } from "./phases";

describe("groupingPhase", () => {
    it("runs with the files done", () => {
        expect(groupingPhase({ done: 0, total: 48 })).toEqual({ state: "active", status: "0 / 48" });
        expect(groupingPhase({ done: 30, total: 48 })).toEqual({ state: "active", status: "30 / 48" });
    });

    it("keeps running while the groups are scored", () => {
        expect(groupingPhase({ done: 48, total: 48 })).toEqual({ state: "active", status: "48 / 48" });
        expect(groupingPhase({ done: 48, total: 48 }, { done: 2, total: 9 })).toEqual({
            state: "active",
            status: "48 / 48",
        });
    });

    it("is done once every pair is scored, or at once with no pair", () => {
        expect(groupingPhase({ done: 48, total: 48 }, { done: 9, total: 9 })).toEqual({
            state: "done",
            status: "Done",
        });
        expect(groupingPhase({ done: 48, total: 48 }, { done: 0, total: 0 })).toEqual({
            state: "done",
            status: "Done",
        });
    });
});
