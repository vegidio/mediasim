import { describe, expect, it } from "vitest";
import type { GroupFile, ScanGroup } from "@/ipc/scan";
import { autoSelect, type GroupView, keepBestOnly, markedFiles, pickBest, preview, visibleGroups } from "./marks";
import { DEFAULT_RULES, moveRule, type Rule } from "./rules";

const file = (path: string): GroupFile => ({ path, type: "image", width: 1, height: 1, size: 1 });

/** Group `name` of `size` files, `/<name>/0` to `/<name>/<size - 1>`, with file `best` as its best. */
const group = (name: string, size: number, best = 0): GroupView => ({
    files: Array.from({ length: size }, (_, i) => file(`/${name}/${i}`)),
    best,
});

/** 7 groups holding 18 files, with the best file at different places. */
const GROUPS = Array.from({ length: 7 }, (_, i) => group(`g${i}`, i < 4 ? 3 : 2, i % 2));

describe("autoSelect", () => {
    it("marks the 11 files that are not best files, and no best file", () => {
        const marks = autoSelect(GROUPS);

        expect(marks.size).toBe(11);
        for (const { files, best } of GROUPS) {
            files.forEach((file, index) => {
                expect(marks.has(file.path)).toBe(index !== best);
            });
        }
    });

    it("unmarks a best file that was marked before, once its result replaces the marks", () => {
        let marks: ReadonlySet<string> = new Set(["/g1/1", "/g0/1"]);

        marks = autoSelect(GROUPS);

        expect(marks.has("/g1/1")).toBe(false);
        expect(marks.has("/g0/1")).toBe(true);
    });
});

describe("keepBestOnly", () => {
    it("unmarks the group's best file, marks its others, and leaves other groups alone", () => {
        const [first, second] = GROUPS;
        if (!first || !second) throw new Error("no groups");
        const marks = new Set(["/g0/0", "/g1/0"]);

        const kept = keepBestOnly(marks, first);

        expect([...kept].sort()).toEqual(["/g0/1", "/g0/2", "/g1/0"]);
        expect([...marks]).toEqual(["/g0/0", "/g1/0"]);
    });
});

describe("markedFiles", () => {
    it("returns the marked files in group order", () => {
        const marks = new Set(["/g2/1", "/g0/2", "/g0/0"]);

        expect(markedFiles(GROUPS, marks).map((file) => file.path)).toEqual(["/g0/0", "/g0/2", "/g2/1"]);
    });
});

describe("pickBest", () => {
    it("picks each group's best file by the rules given", () => {
        const groups = [{ files: [file("/a/2"), file("/a/1")] }, { files: [file("/b/1"), file("/b/2")] }];

        expect(pickBest(groups, DEFAULT_RULES).map(({ best }) => best)).toEqual([1, 0]);
    });
});

describe("preview", () => {
    it("counts the 11 of 18 files that aren't best files", () => {
        expect(preview(GROUPS)).toEqual({ count: 11, bytes: 11, total: 18 });
    });

    describe("of the spec's DSC_0193 group", () => {
        const groups = [
            {
                files: [
                    { ...file("/p/DSC_0193.HEIC"), size: 4_100_000, created: "2025-06-02T00:00:00Z" },
                    { ...file("/p/DSC_0193.jpg"), size: 3_200_000, created: "2025-06-01T00:00:00Z" },
                ],
            },
        ];

        it("frees the smaller JPEG under the default rules", () => {
            expect(preview(pickBest(groups, DEFAULT_RULES))).toEqual({ count: 1, bytes: 3_200_000, total: 2 });
        });

        it("frees the newer HEIC with the creation date on and first", () => {
            const rules: Rule[] = moveRule(
                DEFAULT_RULES.map((rule) => (rule.id === "created" ? { ...rule, on: true } : rule)),
                3,
                0,
            );

            expect(preview(pickBest(groups, rules))).toEqual({ count: 1, bytes: 4_100_000, total: 2 });
        });
    });
});

describe("visibleGroups", () => {
    /** The result's groups: `g0` to `g2`, of 3, 3 and 2 files. */
    const RESULT: ScanGroup[] = [3, 3, 2].map((size, i) => ({
        files: Array.from({ length: size }, (_, j) => file(`/g${i}/${j}`)),
    }));
    const paths = (groups: readonly ScanGroup[]) => groups.map(({ files }) => files.map((f) => f.path));

    it("returns the groups unchanged when nothing is gone", () => {
        expect(visibleGroups(RESULT, new Map())).toEqual(RESULT);
    });

    it("keeps a group of 3 that lost one file, with the other 2 in order", () => {
        const groups = visibleGroups(RESULT, new Map([["/g0/1", "trash"]]));

        expect(paths(groups)).toEqual([
            ["/g0/0", "/g0/2"],
            ["/g1/0", "/g1/1", "/g1/2"],
            ["/g2/0", "/g2/1"],
        ]);
    });

    it("drops a group of 3 that lost 2 files, keeping the later groups' order", () => {
        const groups = visibleGroups(
            RESULT,
            new Map([
                ["/g0/1", "trash"],
                ["/g0/2", "permanent"],
            ]),
        );

        expect(paths(groups)).toEqual([
            ["/g1/0", "/g1/1", "/g1/2"],
            ["/g2/0", "/g2/1"],
        ]);
    });

    it("lets pickBest choose among the files left when the best one is gone", () => {
        const result: ScanGroup[] = [{ files: [file("/a/1"), file("/a/2 (1)"), file("/a/3 copy")] }];
        const [whole] = pickBest(result, DEFAULT_RULES);
        expect(whole?.files[whole.best]?.path).toBe("/a/1");

        const [left] = pickBest(visibleGroups(result, new Map([["/a/1", "permanent"]])), DEFAULT_RULES);

        expect(left?.files.map((f) => f.path)).toEqual(["/a/2 (1)", "/a/3 copy"]);
        expect(left?.files[left.best]?.path).toBe("/a/2 (1)");
    });
});
