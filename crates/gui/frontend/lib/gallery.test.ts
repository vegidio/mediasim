import { describe, expect, it } from "vitest";
import type { MediaType } from "@/ipc/formats";
import type { SourceView } from "@/ipc/set";
import {
    compareCount,
    compareState,
    filterCounts,
    identity,
    includedFiles,
    inclusion,
    isIncluded,
    ordered,
} from "./gallery";

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

describe("inclusion", () => {
    it("includes a file the tab includes and the user left alone", () => {
        expect(inclusion("image", "images", false)).toBe("included");
    });

    it("removes a file the tab includes and the user flipped", () => {
        expect(inclusion("image", "images", true)).toBe("removed");
    });

    it("leaves out a file the tab leaves out and the user left alone", () => {
        expect(inclusion("video", "images", false)).toBe("left-out");
    });

    it("includes a file the tab leaves out and the user flipped", () => {
        expect(inclusion("video", "images", true)).toBe("included");
    });
});

describe("ordered", () => {
    const read = (["a.jpg", "b.mov", "c.jpg", "d.mov", "e.jpg"] as const).map((name) => ({
        path: `/p/${name}`,
        type: (name.endsWith(".mov") ? "video" : "image") as MediaType,
    }));
    const names = (list: readonly { path: string }[]) => list.map((file) => file.path.slice(3));

    it("keeps the display order under Both", () => {
        expect(ordered(read, "both")).toBe(read);
    });

    it("puts the images first under Images, each run in display order", () => {
        expect(names(ordered(read, "images"))).toEqual(["a.jpg", "c.jpg", "e.jpg", "b.mov", "d.mov"]);
    });

    it("puts the videos first under Videos, each run in display order", () => {
        expect(names(ordered(read, "videos"))).toEqual(["b.mov", "d.mov", "a.jpg", "c.jpg", "e.jpg"]);
    });

    it("doesn't move a file the user added or removed", () => {
        const overrides = new Set(["/p/b.mov", "/p/c.jpg"]);

        expect(inclusion("video", "images", overrides.has("/p/b.mov"))).toBe("included");
        expect(inclusion("image", "images", overrides.has("/p/c.jpg"))).toBe("removed");
        // The order reads only each file's kind, so the overrides leave it as it is without them.
        expect(names(ordered(read, "images"))).toEqual(["a.jpg", "c.jpg", "e.jpg", "b.mov", "d.mov"]);
        expect(names(includedFiles(ordered(read, "images"), "images", overrides))).toEqual(["a.jpg", "e.jpg", "b.mov"]);
    });
});

describe("compareCount", () => {
    const paths = (images: number, videos: number) =>
        files(images, videos).map((file, i) => ({ ...file, path: `/p/${i}` }));

    it("counts the files the filter includes when none is overridden", () => {
        expect(compareCount(paths(36, 12), "both", new Set())).toBe(48);
        expect(compareCount(paths(36, 12), "images", new Set())).toBe(36);
    });

    it("leaves out removed files, while the tab counts keep them", () => {
        const all = paths(36, 12);

        expect(compareCount(all, "both", new Set(["/p/0", "/p/1", "/p/40"]))).toBe(45);
        expect(filterCounts(all)).toEqual({ images: 36, videos: 12, both: 48 });
    });

    it("counts an added file, while the tab counts stay the same", () => {
        const all = paths(36, 12);

        expect(compareCount(all, "images", new Set(["/p/40"]))).toBe(37);
        expect(filterCounts(all)).toEqual({ images: 36, videos: 12, both: 48 });
    });

    it("counts added files toward the two files Compare needs", () => {
        const count = compareCount(paths(3, 1), "videos", new Set(["/p/0"]));

        expect(count).toBe(2);
        expect(compareState(count)).toEqual({ label: "Compare 2 files", enabled: true });
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
