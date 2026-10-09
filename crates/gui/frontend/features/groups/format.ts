import type { MediaType } from "@/ipc/formats";
import type { GroupFile } from "@/ipc/scan";
import { formatSize } from "@/lib/format";

/** The last component of a path, on any platform. */
export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

type SummaryCounts = {
    /** The number of files in the groups. */
    files: number;
    groups: number;
    /** The number of files scanned. */
    scanned: number;
    /** In whole percent. */
    threshold: number;
    /** The number of files that couldn't be read. */
    unreadable: number;
};

/**
 * The groups toolbar's summary: "18 similar files in 7 groups · 48 scanned · threshold 85%", or "No similar files found
 * · …" with no group, going on with " · N couldn't be read" when files were skipped.
 */
export const summary = ({ files, groups, scanned, threshold, unreadable }: SummaryCounts) => {
    const found =
        groups === 0
            ? "No similar files found"
            : `${files} similar files in ${groups} ${groups === 1 ? "group" : "groups"}`;
    const skipped = unreadable > 0 ? ` · ${unreadable} couldn't be read` : "";

    return `${found} · ${scanned} scanned · threshold ${threshold}%${skipped}`;
};

/** A group's size: "3 images", "2 videos", or "1 image" for one. */
export const groupSize = (count: number, type: MediaType) => `${count} ${type}${count === 1 ? "" : "s"}`;

/** A grouped file's details: "4032×3024 · 4.8 MB". */
export const detailsLine = ({ width, height, size }: GroupFile) => `${width}×${height} · ${formatSize(size)}`;

/** What the "No similar files found" state says of the `read` files compared at `threshold` percent. */
export const uniqueLine = (read: number, threshold: number) => {
    if (read === 0) return "None of the files could be read.";
    if (read === 1) return `The 1 file compared is unique at the ${threshold}% threshold.`;

    return `The ${read} files compared are unique at the ${threshold}% threshold.`;
};

/** Where the file at `index` of a group of `count` files is, counted from one: "Group 1 · 1 of 3". */
export const groupPosition = (number: number, index: number, count: number) =>
    `Group ${number} · ${index + 1} of ${count}`;
