import { describe, expect, it } from "vitest";
import type { GroupFile } from "@/ipc/scan";
import { bestIndex, copyMarkers, DEFAULT_RULES, type Rule } from "./rules";

const image = (path: string, overrides: Partial<GroupFile> = {}): GroupFile => ({
    path,
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_800_000,
    ...overrides,
});

const video = (path: string, overrides: Partial<GroupFile> = {}): GroupFile => ({
    ...image(path, { type: "video", width: 1920, height: 1080, size: 312_000_000, duration: 42 }),
    ...overrides,
});

/** The path of the best of `files`. */
const best = (files: GroupFile[], rules?: readonly Rule[]) => files[bestIndex(files, rules)]?.path;

describe("DEFAULT_RULES", () => {
    it("follows 9b's order and toggles", () => {
        expect(DEFAULT_RULES).toEqual([
            { id: "duration", on: true },
            { id: "resolution", on: true },
            { id: "size", on: true },
            { id: "created", on: false },
            { id: "name", on: true },
        ]);
    });
});

describe("bestIndex", () => {
    it("picks the cleanest name among copies of one photo", () => {
        const files = [
            image("/p/IMG_2041 (1).jpg"),
            image("/p/IMG_2041-edit.jpg", { width: 2048, height: 1536 }),
            image("/p/IMG_2041.jpg"),
        ];

        expect(best(files)).toBe("/p/IMG_2041.jpg");
    });

    it("picks the larger file", () => {
        const files = [image("/p/DSC_0193.HEIC", { size: 4_100_000 }), image("/p/DSC_0193.jpg", { size: 3_200_000 })];

        expect(best(files)).toBe("/p/DSC_0193.HEIC");
    });

    it("picks the longer video before the higher resolution", () => {
        const files = [
            video("/v/a.mp4", { width: 1920, height: 1080, duration: 30 }),
            video("/v/b.mp4", { width: 1280, height: 720, duration: 60 }),
        ];

        expect(best(files)).toBe("/v/b.mp4");
    });

    it("compares lengths in whole seconds, so resolution decides within the same second", () => {
        const files = [
            video("/v/VID_0714_small.mp4", { width: 1280, height: 720, duration: 42.4 }),
            video("/v/VID_0714.mov", { duration: 42.0 }),
        ];

        expect(best(files)).toBe("/v/VID_0714.mov");
    });

    it("skips the creation date while it is off", () => {
        const files = [
            image("/p/photo copy.jpg", { created: "2020-01-01T00:00:00Z" }),
            image("/p/photo.jpg", { created: "2024-01-01T00:00:00Z" }),
        ];

        expect(best(files)).toBe("/p/photo.jpg");
    });

    it("breaks a full tie by the path that sorts first", () => {
        expect(best([image("/b/cat.png"), image("/a/cat.png")])).toBe("/a/cat.png");
    });

    describe("with the creation date on", () => {
        const rules = DEFAULT_RULES.map((rule) => (rule.id === "created" ? { ...rule, on: true } : rule));

        it("picks the earlier date", () => {
            const files = [
                image("/p/new.jpg", { created: "2024-01-01T00:00:00Z" }),
                image("/p/old copy.jpg", { created: "2020-01-01T00:00:00Z" }),
            ];

            expect(best(files, rules)).toBe("/p/old copy.jpg");
        });

        it("never picks a file without a date by it", () => {
            const files = [image("/p/a.jpg"), image("/p/b copy.jpg", { created: "2024-01-01T00:00:00Z" })];

            expect(best(files, rules)).toBe("/p/b copy.jpg");
        });

        it("ties two files without a date", () => {
            expect(best([image("/p/a copy.jpg"), image("/p/b.jpg")], rules)).toBe("/p/b.jpg");
        });
    });
});

describe("copyMarkers", () => {
    it.each([
        ["IMG_2041.jpg", 0],
        ["IMG_2041 (1).jpg", 1],
        ["IMG_2041-edit.jpg", 1],
        ["Screenshot 10.14 copy.png", 1],
        ["photo - Copy (2).jpg", 2],
        ["P1010022-small.jpg", 0],
        ["copy.jpg", 0],
        ["IMG(2).jpg", 1],
        ["clip_edited.mp4", 1],
        ["photo-copy.jpg", 1],
        ["photo copy 2.jpg", 1],
    ])("counts %s as %i", (name, count) => {
        expect(copyMarkers(name)).toBe(count);
    });
});
