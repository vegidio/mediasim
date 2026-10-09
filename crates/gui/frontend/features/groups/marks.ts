import type { GroupFile } from "@/ipc/scan";
import { totalSize } from "@/lib/format";
import type { GroupView } from "./GroupCard";
import { bestIndex, type Rule } from "./rules";

/** `groups` with each one's best file picked by `rules`. */
export const pickBest = (groups: readonly { files: readonly GroupFile[] }[], rules: readonly Rule[]): GroupView[] =>
    groups.map(({ files }) => ({ files, best: bestIndex(files, rules) }));

/** What Auto-select would mark in `groups`. */
export type Preview = {
    /** The number of files marked. */
    count: number;
    /** Their combined size, in bytes. */
    bytes: number;
    /** The number of files in the groups. */
    total: number;
};

/** What Auto-select would mark in `groups`: every file that isn't its group's best. */
export const preview = (groups: readonly GroupView[]): Preview => {
    const marked = groups.flatMap(({ files, best }) => files.filter((_, index) => index !== best));
    const total = groups.reduce((sum, { files }) => sum + files.length, 0);

    return { count: marked.length, bytes: totalSize(marked), total };
};

/** The paths of every file that is not its group's best file: what Auto-select marks, replacing every other mark. */
export const autoSelect = (groups: readonly GroupView[]) =>
    new Set(groups.flatMap(({ files, best }) => files.filter((_, index) => index !== best).map((file) => file.path)));

/** `marks` with `group`'s best file unmarked and every other file of it marked, other groups left alone. */
export const keepBestOnly = (marks: ReadonlySet<string>, { files, best }: GroupView) => {
    const kept = new Set(marks);
    files.forEach((file, index) => {
        if (index === best) kept.delete(file.path);
        else kept.add(file.path);
    });
    return kept;
};

/** The files of `groups` whose paths are in `marks`, in group order. */
export const markedFiles = (groups: readonly GroupView[], marks: ReadonlySet<string>): GroupFile[] =>
    groups.flatMap(({ files }) => files.filter((file) => marks.has(file.path)));
