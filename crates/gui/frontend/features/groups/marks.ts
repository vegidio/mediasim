import type { GroupFile, ScanGroup } from "@/ipc/scan";
import { totalSize } from "@/lib/format";
import type { GroupView } from "./GroupCard";
import { bestIndex, type Rule } from "./rules";

/**
 * The groups of `groups` still shown once the files in `gone` have left: each one's files minus those, in order, and
 * only the groups left with 2 files or more.
 */
export const visibleGroups = (groups: readonly ScanGroup[], gone: ReadonlyMap<string, unknown>): ScanGroup[] =>
    groups
        .map((group) => {
            const files = group.files.filter((file) => !gone.has(file.path));
            return files.length === group.files.length ? group : { ...group, files };
        })
        .filter(({ files }) => files.length >= 2);

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

/** The number of files in `groups`. */
export const fileCount = (groups: readonly { files: readonly unknown[] }[]) =>
    groups.reduce((sum, { files }) => sum + files.length, 0);

/** Every file of `groups` that isn't its group's best. */
const extras = (groups: readonly GroupView[]) =>
    groups.flatMap(({ files, best }) => files.filter((_, index) => index !== best));

/** What Auto-select would mark in `groups`: every file that isn't its group's best. */
export const preview = (groups: readonly GroupView[]): Preview => {
    const marked = extras(groups);
    return { count: marked.length, bytes: totalSize(marked), total: fileCount(groups) };
};

/** The paths of every file that is not its group's best file: what Auto-select marks, replacing every other mark. */
export const autoSelect = (groups: readonly GroupView[]) => new Set(extras(groups).map((file) => file.path));

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
export const markedFiles = (
    groups: readonly { files: readonly GroupFile[] }[],
    marks: ReadonlySet<string>,
): GroupFile[] => groups.flatMap(({ files }) => files.filter((file) => marks.has(file.path)));
