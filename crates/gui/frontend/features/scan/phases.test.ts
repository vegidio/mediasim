import { describe, expect, it } from "vitest";
import { groupingPhase } from "./phases";

describe("groupingPhase", () => {
    it("runs with the files done", () => {
        expect(groupingPhase({ done: 0, total: 48 })).toEqual({ state: "active", status: "0 / 48" });
        expect(groupingPhase({ done: 30, total: 48 })).toEqual({ state: "active", status: "30 / 48" });
    });

    it("is done once every file is grouped", () => {
        expect(groupingPhase({ done: 48, total: 48 })).toEqual({ state: "done", status: "Done" });
    });
});
