import type { MediaType } from "@/ipc/formats";
import type { SourceView } from "@/ipc/set";
import type { GalleryFilter } from "@/stores/gallery";
import { formatCount, formatSize, totalSize } from "./format";

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

/**
 * Whether a file is in the comparison: `"included"` when it is, `"removed"` when the tab includes it but the user took
 * it out, and `"left-out"` when the tab leaves it out. A file the user added against the tab counts as `"included"`.
 */
export type Inclusion = "included" | "left-out" | "removed";

/** The {@link Inclusion} of a file of kind `type` under `filter`, flipped against the tab when `overridden`. */
export const inclusion = (type: MediaType, filter: GalleryFilter, overridden: boolean): Inclusion => {
    const byTab = isIncluded(type, filter);
    if (byTab !== overridden) return "included";
    return byTab ? "removed" : "left-out";
};

/**
 * `files` in the grid's order under `filter`: the tab's kind first, then the rest, each run in the order of `files`.
 * Under "both" it is `files` itself. A file's place depends only on its kind, so overriding it never moves it.
 */
export const ordered = <F extends { type: MediaType }>(files: readonly F[], filter: GalleryFilter): readonly F[] => {
    if (filter === "both") return files;

    const first: F[] = [];
    const rest: F[] = [];
    for (const file of files) (isIncluded(file.type, filter) ? first : rest).push(file);
    return [...first, ...rest];
};

/** The `files` a comparison under `filter` includes, in their order, with the `overrides` flipped against the tab. */
export const includedFiles = <F extends { path: string; type: MediaType }>(
    files: readonly F[],
    filter: GalleryFilter,
    overrides: ReadonlySet<string>,
) => files.filter((file) => inclusion(file.type, filter, overrides.has(file.path)) === "included");

/** How many of `files` a comparison under `filter` includes, with the `overrides` flipped against the tab. */
export const compareCount = (
    files: readonly { path: string; type: MediaType }[],
    filter: GalleryFilter,
    overrides: ReadonlySet<string>,
) => includedFiles(files, filter, overrides).length;

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
    const withSize = (text: string) => (size ? `${text} · ${size}` : text);
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
