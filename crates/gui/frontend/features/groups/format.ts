import type { MediaType } from "@/ipc/formats";
import type { GroupFile } from "@/ipc/scan";
import { formatSize } from "@/lib/format";
import type { Preview } from "./marks";

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

/** The counts the summary reads once no group is left. */
type LeftCounts = {
    /** The number of files read less those removed. */
    remaining: number;
    /** In whole percent. */
    threshold: number;
    /** The number of files that couldn't be read. */
    unreadable: number;
};

/**
 * The groups toolbar's summary once removals left no group: "No similar files left · 37 files remaining · threshold
 * 85%", going on with " · N couldn't be read" when files were skipped.
 */
export const leftSummary = ({ remaining, threshold, unreadable }: LeftCounts) => {
    const skipped = unreadable > 0 ? ` · ${unreadable} couldn't be read` : "";

    return `No similar files left · ${remaining} ${remaining === 1 ? "file" : "files"} remaining · threshold ${threshold}%${skipped}`;
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

/**
 * What the "No similar files left" state says of the `groups` the scan found, now resolved, and the `remaining` files
 * at `threshold` percent.
 */
export const resolvedLine = (groups: number, remaining: number, threshold: number) => {
    const resolved = groups === 1 ? "The group is resolved." : `All ${groups} groups are resolved.`;
    const left =
        remaining === 0
            ? "No files remain."
            : remaining === 1
              ? `The 1 remaining file is unique at the ${threshold}% threshold.`
              : `The ${remaining} remaining files are unique at the ${threshold}% threshold.`;

    return `${resolved} ${left}`;
};

/** Where the file at `index` of a group of `count` files is, counted from one: "Group 1 · 1 of 3". */
export const groupPosition = (number: number, index: number, count: number) =>
    `Group ${number} · ${index + 1} of ${count}`;

/** The Auto-select dialog's Apply button: "Apply to 7 groups", or "Apply to 1 group" for one. */
export const applyLabel = (groups: number) => `Apply to ${groups} ${groups === 1 ? "group" : "groups"}`;

/**
 * The Auto-select dialog's preview, in the two parts it styles apart: the `amount` in "Will mark 1 of 2 grouped files",
 * and what follows it, " · 3.2 MB freed", for a preview from `marks`' `preview`.
 */
export const willMark = ({ count, bytes, total }: Preview) => ({
    amount: `${count} of ${total}`,
    freed: ` · ${formatSize(bytes)} freed`,
});
