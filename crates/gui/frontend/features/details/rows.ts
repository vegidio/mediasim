import type { MediaType } from "@/ipc/formats";
import type { MediaInfo } from "@/ipc/pair";
import type { VideoProbe } from "@/ipc/video";
import { formatCreated, formatDuration, formatFrameRate, formatSize } from "@/lib/format";

/** What is known of a file's details: still being read, read, or unreadable. */
export type FileDetails =
    | { status: "loading" }
    | {
          status: "ready";
          info: MediaInfo;
          /** The path as the set list shows it. */
          path: string;
          /** A video's streams, absent for an image or when they couldn't be read. */
          streams?: VideoProbe;
      }
    | { status: "failed" };

/** One row of a details section. */
export type DetailsRow = {
    key: string;
    /** Absent while the details are still being read. */
    value?: string;
    /** Whether the value is shown in the monospaced face, as numbers, dates and the path are. */
    mono?: boolean;
};

/** A titled group of rows. */
export type DetailsSection = { title: "File" | "Image" | "Video"; rows: DetailsRow[] };

const UNKNOWN = "Unknown";

/** The sRGB profile almost every camera and phone embeds, whose full name would break the row. */
const SRGB = "sRGB IEC61966-2.1";

/** A video container's name by extension, since the demuxer's own name, such as `mov,mp4,m4a,3gp,3g2,mj2`, is ambiguous. */
const CONTAINERS: Record<string, string> = {
    mov: "QuickTime",
    mp4: "MPEG-4",
    m4v: "MPEG-4",
    mkv: "Matroska",
    webm: "WebM",
    avi: "AVI",
    wmv: "Windows Media",
};

/** Common names of the codecs FFmpeg names otherwise. */
const CODECS: Record<string, string> = {
    hevc: "HEVC (H.265)",
    h264: "H.264",
    av1: "AV1",
    vp9: "VP9",
    vp8: "VP8",
    mpeg4: "MPEG-4 Part 2",
    prores: "ProRes",
    wmv3: "WMV 9",
    aac: "AAC",
    mp3: "MP3",
    opus: "Opus",
    vorbis: "Vorbis",
    ac3: "AC-3",
    eac3: "E-AC-3",
    flac: "FLAC",
    alac: "ALAC",
    wmav2: "WMA",
};

/** A codec by its common name, or by FFmpeg's when it has none here. */
export const codecName = (codec: string) => (codec.startsWith("pcm_") ? "PCM" : (CODECS[codec] ?? codec));

const extension = (path: string) => {
    const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** A video's container and extension: `QuickTime (.mov)`. */
export const containerName = (path: string) => {
    const ext = extension(path);
    return `${CONTAINERS[ext] ?? ext.toUpperCase()} (.${ext})`;
};

/** A colour profile, with sRGB's full name shortened, or `None` when the file declares none. */
export const formatProfile = (profile?: string) =>
    profile === undefined ? "None" : profile === SRGB ? "sRGB" : profile;

/** Width times height in millions, with one decimal: `12.2 MP`. */
export const formatMegapixels = (width: number, height: number) => `${((width * height) / 1e6).toFixed(1)} MP`;

/** A rate in bits per second, in megabits with one decimal from 1 Mb/s, in whole kilobits below: `59.4 Mb/s`. */
export const formatBitrate = (bitsPerSecond: number) =>
    // Promote on the rounded value, so 999,999 b/s reads `1.0 Mb/s` rather than `1000 kb/s`.
    Math.round(bitsPerSecond / 1000) >= 1000
        ? `${(bitsPerSecond / 1e6).toFixed(1)} Mb/s`
        : `${Math.round(bitsPerSecond / 1000)} kb/s`;

/** A sample rate in kilohertz, without trailing zeros: `48 kHz`, `44.1 kHz`. */
const formatSampleRate = (hertz: number) => `${Number((hertz / 1000).toFixed(1))} kHz`;

const formatDimensions = ({ width, height }: MediaInfo) => `${width} × ${height}`;

const formatDate = (rfc3339?: string) => (rfc3339 ? formatCreated(rfc3339) : UNKNOWN);

/** The file's overall bit rate, from its size and duration. */
const bitrate = ({ size, duration }: MediaInfo) => (duration ? formatBitrate((size * 8) / duration) : UNKNOWN);

/** The main audio stream as `AAC · 48 kHz`, `None` without one, and `Unknown` when the streams couldn't be read. */
const audio = (streams?: VideoProbe) => {
    if (!streams) return UNKNOWN;
    if (!streams.audio) return "None";

    const { codec, sampleRate } = streams.audio;
    return sampleRate === undefined ? codecName(codec) : `${codecName(codec)} · ${formatSampleRate(sampleRate)}`;
};

type Ready = Extract<FileDetails, { status: "ready" }>;

type RowSpec = { key: string; mono?: boolean; value: (details: Ready) => string };

const FILE_ROWS: readonly RowSpec[] = [
    { key: "Path", mono: true, value: ({ path }) => path },
    { key: "Size", mono: true, value: ({ info }) => formatSize(info.size) },
    {
        key: "Format",
        value: ({ info }) => (info.type === "video" ? containerName(info.path) : (info.format ?? UNKNOWN)),
    },
    { key: "Created", mono: true, value: ({ info }) => formatDate(info.created) },
    { key: "Modified", mono: true, value: ({ info }) => formatDate(info.modified) },
];

const IMAGE_ROWS: readonly RowSpec[] = [
    { key: "Dimensions", mono: true, value: ({ info }) => formatDimensions(info) },
    { key: "Megapixels", mono: true, value: ({ info }) => formatMegapixels(info.width, info.height) },
    { key: "Colour profile", value: ({ info }) => formatProfile(info.colorProfile) },
];

const VIDEO_ROWS: readonly RowSpec[] = [
    {
        key: "Duration",
        mono: true,
        value: ({ info }) => (info.duration === undefined ? UNKNOWN : formatDuration(info.duration)),
    },
    { key: "Resolution", mono: true, value: ({ info }) => formatDimensions(info) },
    {
        key: "Frame rate",
        mono: true,
        value: ({ info }) => (info.frameRate === undefined ? UNKNOWN : formatFrameRate(info.frameRate)),
    },
    { key: "Codec", value: ({ streams }) => (streams?.video ? codecName(streams.video.codec) : UNKNOWN) },
    { key: "Bitrate", mono: true, value: ({ info }) => bitrate(info) },
    { key: "Audio", value: ({ streams }) => audio(streams) },
];

const rows = (specs: readonly RowSpec[], details: FileDetails): DetailsRow[] =>
    specs.map(({ key, mono, value }) => {
        const row = { key, ...(mono && { mono }) };
        if (details.status === "loading") return row;
        if (details.status === "failed") return { ...row, value: UNKNOWN };

        return { ...row, value: value(details) };
    });

/**
 * The sidebar's sections for a file of type `type`: File, then Image or Video. Each value is absent while `details`
 * are loading, and `Unknown` when they could not be read.
 */
export const detailsSections = (type: MediaType, details: FileDetails): DetailsSection[] => [
    { title: "File", rows: rows(FILE_ROWS, details) },
    type === "image"
        ? { title: "Image", rows: rows(IMAGE_ROWS, details) }
        : { title: "Video", rows: rows(VIDEO_ROWS, details) },
];
