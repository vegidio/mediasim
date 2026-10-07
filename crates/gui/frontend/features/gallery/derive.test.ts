import { describe, expect, it } from "vitest";
import type { MediaType } from "@/ipc/formats";
import type { SourceView } from "@/ipc/set";
import { compareState, filterCounts, identity, isIncluded } from "./derive";

const files = (images: number, videos: number) => [
    ...Array.from({ length: images }, () => ({ type: "image" as MediaType })),
    ...Array.from({ length: videos }, () => ({ type: "video" as MediaType })),
];

const source = (overrides: Partial<SourceView>): SourceView => ({
    path: "/p",
    name: "p",
    location: "~",
    kind: "folder",
    count: 0,
    size: 0,
    unreadable: false,
    pending: false,
    ...overrides,
});

describe("filterCounts", () => {
    it("counts images, videos and both", () => {
        expect(filterCounts(files(36, 12))).toEqual({ images: 36, videos: 12, both: 48 });
    });

    it("counts nothing for no files", () => {
        expect(filterCounts([])).toEqual({ images: 0, videos: 0, both: 0 });
    });
});

describe("isIncluded", () => {
    it("includes every kind under Both", () => {
        expect(isIncluded("image", "both")).toBe(true);
        expect(isIncluded("video", "both")).toBe(true);
    });

    it("includes only the tab's kind otherwise", () => {
        expect(isIncluded("image", "images")).toBe(true);
        expect(isIncluded("video", "images")).toBe(false);
        expect(isIncluded("video", "videos")).toBe(true);
        expect(isIncluded("image", "videos")).toBe(false);
    });
});

describe("compareState", () => {
    it("follows the filter's count", () => {
        expect(compareState(filterCounts(files(36, 12)).images)).toEqual({ label: "Compare 36 files", enabled: true });
    });

    it("is disabled below two files, in the singular for one", () => {
        expect(compareState(filterCounts(files(3, 1)).videos)).toEqual({ label: "Compare 1 file", enabled: false });
        expect(compareState(0)).toEqual({ label: "Compare 0 files", enabled: false });
    });

    it("reads Compare and is disabled while the files are read", () => {
        expect(compareState()).toEqual({ label: "Compare", enabled: false });
    });
});

describe("identity", () => {
    const holiday = source({ name: "Holiday 2025", location: "~/Pictures/Holiday 2025" });

    it("shows one folder by its name, path and size", () => {
        expect(identity([holiday], 2, [{ size: 700_000_000 }, { size: 500_000_000 }])).toEqual({
            kind: "folder",
            title: "Holiday 2025",
            details: "~/Pictures/Holiday 2025 · 1.2 GB",
        });
    });

    it("counts the distinct locations of several sources", () => {
        const sources = [
            source({ name: "A", location: "~/Pictures/A" }),
            source({ name: "B", location: "~/Pictures/B" }),
            source({ name: "x.jpg", kind: "image", location: "~/Downloads" }),
            source({ name: "y.mp4", kind: "video", location: "~/Downloads" }),
        ];
        const read = Array.from({ length: 18 }, (_, i) => ({ size: i === 0 ? 562_700_000 : 0 }));

        expect(identity(sources, 18, read)).toEqual({
            kind: "files",
            title: "18 files",
            details: "From 3 locations · 562.7 MB",
        });
    });

    it("reads in the singular for one file in one location", () => {
        const sources = [source({ name: "x.jpg", kind: "image", location: "~/Downloads" })];

        expect(identity(sources, 1, [{ size: 3_100_000 }])).toEqual({
            kind: "files",
            title: "1 file",
            details: "From 1 location · 3.1 MB",
        });
    });

    it("leaves out the size and counts the set's total while the files are read", () => {
        expect(identity([holiday], 48)).toEqual({
            kind: "folder",
            title: "Holiday 2025",
            details: "~/Pictures/Holiday 2025",
        });
        expect(identity([holiday, source({ location: "~/B" })], 48).title).toBe("48 files");
    });

    it("counts the files read rather than the set's total", () => {
        const sources = [holiday, source({ location: "~/B" })];

        expect(
            identity(
                sources,
                10,
                Array.from({ length: 9 }, () => ({ size: 0 })),
            ).title,
        ).toBe("9 files");
    });
});
