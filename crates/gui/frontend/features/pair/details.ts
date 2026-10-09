import type { MediaType } from "@/ipc/formats";
import type { MediaInfo } from "@/ipc/pair";
import { formatCreated, formatDuration, formatFrameRate, formatSize } from "@/lib/format";
import { type Details, formatResolution, rowsFor, shortProfile, UNKNOWN } from "@/lib/mediaInfo";

/** The mark a row gets on the file whose value stands out of the two: higher, bigger, older or longer. */
export type Badge = "Higher" | "Bigger" | "Older" | "Longer";

/** One row of a file pane's details. */
export type DetailRow = {
    key: string;
    /** Absent while the details are still being read. */
    value?: string;
    badge?: Badge;
};

/** An image format, followed by its color profile when it declares one: `JPEG · Display P3`, `PNG`. */
export const formatFormat = (format: string, colorProfile?: string) =>
    colorProfile ? `${format} · ${shortProfile(colorProfile)}` : format;

const pixels = ({ width, height }: MediaInfo) => width * height;

const createdAt = ({ created }: MediaInfo) => (created ? Date.parse(created) : undefined);

/** The duration in whole seconds, as the row shows it, so a difference too small to read earns no badge. */
const shownDuration = ({ duration }: MediaInfo) => (duration === undefined ? undefined : Math.floor(duration));

/** `badge` when `mine` beats `theirs` by `better`, and nothing when either is absent or they are equal. */
const mark = <T>(badge: Badge, better: (a: T, b: T) => boolean, mine?: T, theirs?: T) =>
    mine !== undefined && theirs !== undefined && better(mine, theirs) ? { badge } : {};

type RowSpec = {
    key: string;
    value: (info: MediaInfo) => string;
    /** The badge this row earns against the other file's details, if any. */
    badge?: (info: MediaInfo, other: MediaInfo) => { badge?: Badge };
};

const RESOLUTION: RowSpec = {
    key: "Resolution",
    value: formatResolution,
    badge: (info, other) => mark("Higher", (a, b) => a > b, pixels(info), pixels(other)),
};

const FILE_SIZE: RowSpec = {
    key: "File size",
    value: ({ size }) => formatSize(size),
    badge: (info, other) => mark("Bigger", (a, b) => a > b, info.size, other.size),
};

const IMAGE_ROWS: readonly RowSpec[] = [
    RESOLUTION,
    FILE_SIZE,
    { key: "Format", value: ({ format, colorProfile }) => (format ? formatFormat(format, colorProfile) : UNKNOWN) },
    {
        key: "Created",
        value: ({ created }) => (created ? formatCreated(created) : UNKNOWN),
        badge: (info, other) => mark("Older", (a, b) => a < b, createdAt(info), createdAt(other)),
    },
];

const VIDEO_ROWS: readonly RowSpec[] = [
    {
        key: "Duration",
        value: ({ duration }) => (duration === undefined ? UNKNOWN : formatDuration(duration)),
        badge: (info, other) => mark("Longer", (a, b) => a > b, shownDuration(info), shownDuration(other)),
    },
    RESOLUTION,
    { key: "Frame rate", value: ({ frameRate }) => (frameRate === undefined ? UNKNOWN : formatFrameRate(frameRate)) },
    FILE_SIZE,
];

/**
 * The detail rows of a file of type `type`, in the order its pane lists them. Each value is absent while `details`
 * are loading, and `Unknown` when they could not be read. Once both files' details are read, the rows where this file
 * has the higher, bigger, older or longer value carry a badge.
 */
export const detailRows = (type: MediaType, details: Details, other?: Details): DetailRow[] =>
    rowsFor(
        type === "image" ? IMAGE_ROWS : VIDEO_ROWS,
        details,
        ({ key }): DetailRow => ({ key }),
        ({ value, badge }, { info }) => ({
            value: value(info),
            ...(badge && other?.status === "ready" && badge(info, other.info)),
        }),
    );
