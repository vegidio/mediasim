import { describe, expect, it } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import { applyLabel, detailsLine, fileName, groupPosition, groupSize, summary, uniqueLine, willMark } from "./format";

describe("summary", () => {
    it("counts several groups", () => {
        expect(summary({ files: 18, groups: 7, scanned: 48, threshold: 85, unreadable: 0 })).toBe(
            "18 similar files in 7 groups · 48 scanned · threshold 85%",
        );
    });

    it("reads one group, and goes on with the unreadable files", () => {
        expect(summary({ files: 2, groups: 1, scanned: 10, threshold: 90, unreadable: 3 })).toBe(
            "2 similar files in 1 group · 10 scanned · threshold 90% · 3 couldn't be read",
        );
    });

    it("reads no group", () => {
        expect(summary({ files: 0, groups: 0, scanned: 48, threshold: 85, unreadable: 2 })).toBe(
            "No similar files found · 48 scanned · threshold 85% · 2 couldn't be read",
        );
        expect(summary({ files: 0, groups: 0, scanned: 48, threshold: 85, unreadable: 0 })).toBe(
            "No similar files found · 48 scanned · threshold 85%",
        );
    });
});

describe("groupSize", () => {
    it.each([
        [3, "image", "3 images"],
        [2, "video", "2 videos"],
        [1, "image", "1 image"],
        [1, "video", "1 video"],
    ] as const)("reads %s %s as %s", (count, type, text) => {
        expect(groupSize(count, type)).toBe(text);
    });
});

describe("detailsLine", () => {
    it("reads the resolution and the size in decimal units", () => {
        const file: GroupFile = { path: "/a/IMG_2041.jpg", type: "image", width: 4032, height: 3024, size: 4_800_000 };

        expect(detailsLine(file)).toBe("4032×3024 · 4.8 MB");
    });
});

describe("uniqueLine", () => {
    it("counts the files compared", () => {
        expect(uniqueLine(46, 85)).toBe("The 46 files compared are unique at the 85% threshold.");
    });

    it("reads one file", () => {
        expect(uniqueLine(1, 90)).toBe("The 1 file compared is unique at the 90% threshold.");
    });

    it("says when none could be read", () => {
        expect(uniqueLine(0, 85)).toBe("None of the files could be read.");
    });
});

describe("fileName", () => {
    it("takes the last component on any platform", () => {
        expect(fileName("/a/b/IMG_2041.jpg")).toBe("IMG_2041.jpg");
        expect(fileName("C:\\Users\\ana\\cat.png")).toBe("cat.png");
    });
});

describe("groupPosition", () => {
    it.each([
        [1, 0, 3, "Group 1 · 1 of 3"],
        [3, 1, 2, "Group 3 · 2 of 2"],
        [1, 11, 19, "Group 1 · 12 of 19"],
    ])("reads group %i, index %i of %i, as %s", (number, index, count, expected) => {
        expect(groupPosition(number, index, count)).toBe(expected);
    });
});

describe("applyLabel", () => {
    it.each([
        [1, "Apply to 1 group"],
        [7, "Apply to 7 groups"],
    ])("reads %i groups as %s", (groups, label) => {
        expect(applyLabel(groups)).toBe(label);
    });
});

describe("willMark", () => {
    it("reads the files marked of those grouped, and the space freed in decimal units", () => {
        const { amount, freed } = willMark({ count: 1, bytes: 3_200_000, total: 2 });

        expect(`Will mark ${amount} grouped files${freed}`).toBe("Will mark 1 of 2 grouped files · 3.2 MB freed");
    });
});
