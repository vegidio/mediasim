import { describe, expect, it } from "vitest";
import type { MediaInfo } from "@/ipc/pair";
import type { VideoProbe } from "@/ipc/video";
import {
    codecName,
    containerName,
    detailsSections,
    type FileDetails,
    formatBitrate,
    formatMegapixels,
    formatProfile,
} from "./rows";

/** An RFC 3339 time for a local wall-clock time, so the expectations hold in any time zone. */
const local = (year: number, month: number, day: number, hours = 0, minutes = 0) =>
    new Date(year, month - 1, day, hours, minutes).toISOString();

const IMAGE: MediaInfo = {
    path: "/Users/me/Pictures/Holiday 2025/DSC_0193.HEIC",
    type: "image",
    width: 4032,
    height: 3024,
    size: 4_100_000,
    format: "HEIC",
    colorProfile: "Display P3",
    bitDepth: 8,
    created: local(2025, 7, 14, 20, 41),
    modified: local(2025, 7, 15, 9, 3),
};

const VIDEO: MediaInfo = {
    path: "/Users/me/Movies/VID_0714.mov",
    type: "video",
    width: 1920,
    height: 1080,
    size: 312_000_000,
    duration: 42,
    frameRate: 30000 / 1001,
};

const STREAMS: VideoProbe = {
    format: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: 42,
    video: { codec: "hevc", decodable: true },
    audio: { codec: "aac", decodable: true, sampleRate: 48000 },
};

/** Each section as its title, then its rows as `key: value`, for compact expectations. */
const lines = (...args: Parameters<typeof detailsSections>) =>
    detailsSections(...args).flatMap(({ title, rows }) => [
        title,
        ...rows.map(({ key, value }) => `${key}: ${value ?? "…"}`),
    ]);

const ready = (info: MediaInfo, path: string, streams?: VideoProbe): FileDetails => ({
    status: "ready",
    info,
    path,
    ...(streams && { streams }),
});

describe("detailsSections", () => {
    it("lists an image's File and Image sections", () => {
        expect(lines("image", ready(IMAGE, "~/Pictures/Holiday 2025/DSC_0193.HEIC"))).toEqual([
            "File",
            "Path: ~/Pictures/Holiday 2025/DSC_0193.HEIC",
            "Size: 4.1 MB",
            "Format: HEIC",
            "Created: 2025-07-14 20:41",
            "Modified: 2025-07-15 09:03",
            "Image",
            "Dimensions: 4032 × 3024",
            "Megapixels: 12.2 MP",
            "Colour profile: Display P3",
            "Bit depth: 8-bit",
        ]);
    });

    it("reads an image's bit depth, or Unknown when the file doesn't give one", () => {
        const { bitDepth: _, ...bare } = IMAGE;

        expect(lines("image", ready({ ...IMAGE, bitDepth: 10 }, "~/a.heic"))).toContain("Bit depth: 10-bit");
        expect(lines("image", ready(bare, "~/a.heic"))).toContain("Bit depth: Unknown");
    });

    it("shows a placeholder for the bit depth while loading", () => {
        expect(lines("image", { status: "loading" })).toContain("Bit depth: …");
    });

    it("lists a video's File and Video sections", () => {
        expect(lines("video", ready(VIDEO, "~/Movies/VID_0714.mov", STREAMS))).toEqual([
            "File",
            "Path: ~/Movies/VID_0714.mov",
            "Size: 312.0 MB",
            "Format: QuickTime (.mov)",
            "Created: Unknown",
            "Modified: Unknown",
            "Video",
            "Duration: 0:42",
            "Resolution: 1920 × 1080",
            "Frame rate: 29.97 fps",
            "Codec: HEVC (H.265)",
            "Bitrate: 59.4 Mb/s",
            "Audio: AAC · 48 kHz",
        ]);
    });

    it("reads None for a silent video's audio", () => {
        const { audio: _, ...silent } = STREAMS;

        expect(lines("video", ready(VIDEO, "~/v.mov", silent))).toContain("Audio: None");
    });

    it("reads Unknown for the codec and audio when the streams couldn't be read", () => {
        const shown = lines("video", ready(VIDEO, "~/v.mov"));

        expect(shown).toContain("Codec: Unknown");
        expect(shown).toContain("Audio: Unknown");
        expect(shown).toContain("Bitrate: 59.4 Mb/s");
    });

    it("reads Unknown for a duration, frame rate or bitrate the file doesn't give", () => {
        const { duration: _, frameRate: __, ...bare } = VIDEO;
        const shown = lines("video", ready(bare, "~/v.mov", STREAMS));

        expect(shown).toContain("Duration: Unknown");
        expect(shown).toContain("Frame rate: Unknown");
        expect(shown).toContain("Bitrate: Unknown");
    });

    it("shows a placeholder for every value while loading", () => {
        const sections = detailsSections("video", { status: "loading" });

        expect(sections.map(({ title }) => title)).toEqual(["File", "Video"]);
        expect(sections.flatMap(({ rows }) => rows).every((row) => row.value === undefined)).toBe(true);
    });

    it("reads Unknown for every value when the details can't be read", () => {
        const values = detailsSections("image", { status: "failed" }).flatMap(({ rows }) => rows.map((r) => r.value));

        expect(values).toHaveLength(9);
        expect(new Set(values)).toEqual(new Set(["Unknown"]));
    });

    it("shows numbers, dates and the path in mono, but not names", () => {
        const mono = detailsSections("video", { status: "loading" })
            .flatMap(({ rows }) => rows)
            .filter((row) => row.mono)
            .map((row) => row.key);

        expect(mono).toEqual([
            "Path",
            "Size",
            "Created",
            "Modified",
            "Duration",
            "Resolution",
            "Frame rate",
            "Bitrate",
        ]);
    });
});

describe("containerName", () => {
    it.each([
        ["/a/VID.MOV", "QuickTime (.mov)"],
        ["/a/b.mp4", "MPEG-4 (.mp4)"],
        ["/a/b.m4v", "MPEG-4 (.m4v)"],
        ["/a/b.mkv", "Matroska (.mkv)"],
        ["/a/b.webm", "WebM (.webm)"],
        ["/a/b.avi", "AVI (.avi)"],
        ["C:\\v\\b.wmv", "Windows Media (.wmv)"],
    ])("names %s as %s", (path, expected) => {
        expect(containerName(path)).toBe(expected);
    });
});

describe("codecName", () => {
    it.each([
        ["hevc", "HEVC (H.265)"],
        ["h264", "H.264"],
        ["mpeg4", "MPEG-4 Part 2"],
        ["eac3", "E-AC-3"],
        ["pcm_s16le", "PCM"],
        ["wmav2", "WMA"],
        ["theora", "theora"],
    ])("names %s as %s", (codec, expected) => {
        expect(codecName(codec)).toBe(expected);
    });
});

describe("formatBitrate", () => {
    it.each([
        [(312_000_000 * 8) / 42, "59.4 Mb/s"],
        [58_400_000, "58.4 Mb/s"],
        [640_000, "640 kb/s"],
        [999_999, "1.0 Mb/s"],
    ])("reads %d b/s as %s", (bps, expected) => {
        expect(formatBitrate(bps)).toBe(expected);
    });
});

describe("formatMegapixels", () => {
    it("rounds to one decimal", () => {
        expect(formatMegapixels(4032, 3024)).toBe("12.2 MP");
        expect(formatMegapixels(1920, 1080)).toBe("2.1 MP");
    });
});

describe("formatProfile", () => {
    it("shortens sRGB and reads None without one", () => {
        expect(formatProfile("sRGB IEC61966-2.1")).toBe("sRGB");
        expect(formatProfile("Display P3")).toBe("Display P3");
        expect(formatProfile()).toBe("None");
    });
});

describe("audio sample rates", () => {
    it("drops a trailing zero", () => {
        const at = (sampleRate: number) =>
            lines(
                "video",
                ready(VIDEO, "~/v.mov", { ...STREAMS, audio: { codec: "aac", decodable: true, sampleRate } }),
            );

        expect(at(44100)).toContain("Audio: AAC · 44.1 kHz");
        expect(at(48000)).toContain("Audio: AAC · 48 kHz");
    });
});
