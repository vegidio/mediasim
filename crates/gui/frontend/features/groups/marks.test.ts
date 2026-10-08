import { describe, expect, it } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import type { GroupView } from "./GroupCard";
import { autoSelect, keepBestOnly, markedFiles } from "./marks";

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
