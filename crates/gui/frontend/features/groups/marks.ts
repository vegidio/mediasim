import type { GroupFile } from "@/ipc/scan";
import type { GroupView } from "./GroupCard";

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
