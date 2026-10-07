import { describe, expect, it } from "vitest";
import type { MediaInfo } from "@/ipc/pair";
import { type Details, detailRows, formatFormat } from "./details";

/** An RFC 3339 time for a local wall-clock time, so the expectations hold in any time zone. */
const local = (year: number, month: number, day: number, hours = 0, minutes = 0) =>
    new Date(year, month - 1, day, hours, minutes).toISOString();

const image = (info: Partial<MediaInfo> = {}): MediaInfo => ({
    path: "/IMG_2041.jpg",
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_800_000,
    format: "JPEG",
    colorProfile: "Display P3",
    created: local(2025, 7, 14, 20, 41),
    ...info,
});

const video = (info: Partial<MediaInfo> = {}): MediaInfo => ({
    path: "/clip.mp4",
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42.6,
    frameRate: 30000 / 1001,
    ...info,
});

const ready = (info: MediaInfo): Details => ({ status: "ready", info });

/** Each row as `key: value [badge]`, for compact expectations. */
const lines = (...args: Parameters<typeof detailRows>) =>
    detailRows(...args).map(({ key, value, badge }) => `${key}: ${value ?? "…"}${badge ? ` [${badge}]` : ""}`);

describe("formatFormat", () => {
    it("adds the color profile after the format", () => {
        expect(formatFormat("JPEG", "Display P3")).toBe("JPEG · Display P3");
    });

    it("shortens the sRGB profile, and only that one", () => {
        expect(formatFormat("PNG", "sRGB IEC61966-2.1")).toBe("PNG · sRGB");
        expect(formatFormat("PNG", "sRGB built-in")).toBe("PNG · sRGB built-in");
    });

    it("shows the format alone without a profile", () => {
        expect(formatFormat("PNG")).toBe("PNG");
    });
});

describe("detailRows", () => {
    it("lists an image's details in order", () => {
        expect(lines("image", ready(image()))).toEqual([
            "Resolution: 4032 × 3024",
            "File size: 4.8 MB",
            "Format: JPEG · Display P3",
            "Created: 2025-07-14 20:41",
        ]);
    });

    it("reads an image without a profile or a creation time", () => {
        const { colorProfile: _, created: __, ...png } = image({ format: "PNG" });

        expect(lines("image", ready(png))).toContain("Format: PNG");
        expect(lines("image", ready(png))).toContain("Created: Unknown");
    });

    it("lists a video's details in order", () => {
        expect(lines("video", ready(video()))).toEqual([
            "Duration: 0:42",
            "Resolution: 1920 × 1080",
            "Frame rate: 29.97 fps",
            "File size: 312.0 MB",
        ]);
    });

    it("reads a video without a frame rate as Unknown", () => {
        const { frameRate: _, ...noRate } = video();

        expect(lines("video", ready(noRate))).toContain("Frame rate: Unknown");
    });

    it("leaves every value out while loading", () => {
        expect(detailRows("image", { status: "loading" })).toEqual([
            { key: "Resolution" },
            { key: "File size" },
            { key: "Format" },
            { key: "Created" },
        ]);
        expect(detailRows("video", { status: "loading" }).map(({ key }) => key)).toEqual([
            "Duration",
            "Resolution",
            "Frame rate",
            "File size",
        ]);
    });

    it("shows every value as Unknown when the details could not be read", () => {
        expect(detailRows("video", { status: "failed" }, ready(video())).map(({ value }) => value)).toEqual([
            "Unknown",
            "Unknown",
            "Unknown",
            "Unknown",
        ]);
    });

    describe("badges", () => {
        const a = image();
        const b = image({ width: 2048, height: 1536, size: 1_100_000, created: local(2025, 8, 2) });

        it("marks the higher resolution, the bigger file and the older image, in both orders", () => {
            expect(lines("image", ready(a), ready(b))).toEqual([
                "Resolution: 4032 × 3024 [Higher]",
                "File size: 4.8 MB [Bigger]",
                "Format: JPEG · Display P3",
                "Created: 2025-07-14 20:41 [Older]",
            ]);
            expect(lines("image", ready(b), ready(a))).toEqual([
                "Resolution: 2048 × 1536",
                "File size: 1.1 MB",
                "Format: JPEG · Display P3",
                "Created: 2025-08-02 00:00",
            ]);
        });

        it("compares resolutions by pixel count", () => {
            const wide = image({ width: 4000, height: 1000 });
            const square = image({ width: 2100, height: 2100 });

            expect(detailRows("image", ready(square), ready(wide))[0]).toHaveProperty("badge", "Higher");
            expect(detailRows("image", ready(wide), ready(square))[0]).not.toHaveProperty("badge");
        });

        it("marks nothing when values are equal", () => {
            const rows = [
                ...detailRows("video", ready(video()), ready(video())),
                ...detailRows("image", ready(a), ready(a)),
            ];

            expect(rows.filter((row) => row.badge)).toEqual([]);
        });

        it("marks no Created row when either creation time is missing", () => {
            const { created: _, ...undated } = b;

            expect(detailRows("image", ready(a), ready(undated))[3]).not.toHaveProperty("badge");
            expect(detailRows("image", ready(undated), ready(a))[3]).not.toHaveProperty("badge");
        });

        it("marks the longer and the bigger video, in both orders, and nothing on Frame rate", () => {
            const short = video({ duration: 10, frameRate: 24, size: 100 });

            expect(lines("video", ready(short), ready(video()))).toEqual([
                "Duration: 0:10",
                "Resolution: 1920 × 1080",
                "Frame rate: 24 fps",
                "File size: 100 B",
            ]);
            expect(lines("video", ready(video()), ready(short))).toEqual([
                "Duration: 0:42 [Longer]",
                "Resolution: 1920 × 1080",
                "Frame rate: 29.97 fps",
                "File size: 312.0 MB [Bigger]",
            ]);
        });

        it("marks the longer video and the bigger video separately", () => {
            const longButSmall = video({ duration: 60, size: 100 });

            expect(lines("video", ready(longButSmall), ready(video()))[0]).toBe("Duration: 1:00 [Longer]");
            expect(lines("video", ready(video()), ready(longButSmall))[3]).toBe("File size: 312.0 MB [Bigger]");
        });

        it("marks neither video longer when both read the same duration", () => {
            const [mkv, mp4] = [video({ duration: 42.166 }), video({ duration: 42.067 })];

            expect(lines("video", ready(mkv), ready(mp4))[0]).toBe("Duration: 0:42");
            expect(lines("video", ready(mp4), ready(mkv))[0]).toBe("Duration: 0:42");
        });

        it("marks the longer video once the durations read differently", () => {
            const [longer, shorter] = [video({ duration: 43.01 }), video({ duration: 42.99 })];

            expect(lines("video", ready(longer), ready(shorter))[0]).toBe("Duration: 0:43 [Longer]");
            expect(lines("video", ready(shorter), ready(longer))[0]).toBe("Duration: 0:42");
        });

        it("marks nothing until the other file's details are read", () => {
            for (const other of [undefined, { status: "loading" } as const, { status: "failed" } as const]) {
                expect(detailRows("image", ready(a), other).filter((row) => row.badge)).toEqual([]);
            }
        });
    });
});
