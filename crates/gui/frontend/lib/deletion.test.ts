import { describe, expect, it } from "vitest";
import { deletionLabel } from "./deletion";

describe("deletionLabel", () => {
    it.each([
        ["trash", true, 2, "Move 2 to Trash…"],
        ["trash", false, 2, "Move 2 to Trash"],
        ["permanent", false, 3, "Delete 3 permanently"],
        ["permanent", true, 3, "Delete 3 permanently…"],
    ] as const)("reads, in %s mode with confirm %s and %i files, %s", (mode, confirm, count, label) => {
        expect(deletionLabel(mode, confirm, count)).toBe(label);
    });
});
