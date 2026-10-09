import { describe, expect, it } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import type { GroupView } from "./GroupCard";
import { autoSelect, keepBestOnly, markedFiles, pickBest, preview } from "./marks";
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
