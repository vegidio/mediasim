import type { MediaType } from "@/ipc/formats";
import type { SourceView } from "@/ipc/set";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import type { GalleryFilter } from "@/stores/gallery";

/** How many files each filter includes. */
export type FilterCounts = Record<GalleryFilter, number>;

/** How many of `files` each filter includes. */
export const filterCounts = (files: readonly { type: MediaType }[]): FilterCounts => {
    const videos = files.filter((file) => file.type === "video").length;
    return { images: files.length - videos, videos, both: files.length };
};

/** Whether a file of kind `type` is part of a comparison under `filter`. */
export const isIncluded = (type: MediaType, filter: GalleryFilter) =>
    filter === "both" || (filter === "images" ? type === "image" : type === "video");

/** How many of `files` a comparison under `filter` includes, leaving out those `removed` from it. */
export const compareCount = (
    files: readonly { path: string; type: MediaType }[],
    filter: GalleryFilter,
    removed: ReadonlySet<string>,
) => files.filter((file) => isIncluded(file.type, filter) && !removed.has(file.path)).length;

/** What the Compare button reads, and whether it can be activated. */
export type CompareState = { label: string; enabled: boolean };

/**
 * The Compare button for `count` included files, or for a set still being read when `count` is `undefined`: disabled
 * and reading "Compare" then, and below two files.
 */
export const compareState = (count?: number): CompareState =>
    count === undefined
        ? { label: "Compare", enabled: false }
        : { label: `Compare ${formatCount(count)}`, enabled: count >= 2 };

/** What the identity block shows: a folder or a group of files, its title, and its details line. */
export type Identity = { kind: "folder" | "files"; title: string; details: string };

/**
 * The identity block for a set of `sources` whose files are `files`, or still being read when `files` is `undefined`,
 * with `total` files counted. The size is left out of the details until the files are read.
 */
export const identity = (
    sources: readonly SourceView[],
    total: number,
    files?: readonly { size: number }[],
): Identity => {
    const size = files && formatSize(totalSize(files));
    const withSize = (text: string) => (size === undefined ? text : `${text} · ${size}`);
    const [only] = sources;

    if (sources.length === 1 && only?.kind === "folder") {
        return { kind: "folder", title: only.name, details: withSize(only.location) };
    }

    const locations = new Set(sources.map((source) => source.location)).size;
    return {
        kind: "files",
        title: formatCount(files?.length ?? total),
        details: withSize(`From ${locations} ${locations === 1 ? "location" : "locations"}`),
    };
};
