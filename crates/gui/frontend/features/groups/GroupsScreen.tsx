import { useMemo } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaFile } from "@/ipc/thumbs";
import { useScanStore } from "@/stores/scan";
import { summary, uniqueLine } from "./format";
import { GroupCard, type GroupView } from "./GroupCard";
import { GroupsFooter } from "./GroupsFooter";
import { GroupsToolbar, useNewComparison } from "./GroupsToolbar";
import { autoSelect, keepBestOnly, markedFiles } from "./marks";
import { bestIndex } from "./rules";

/** What the groups area shows when the scan found no group: the files compared are unique, and New comparison. */
const NothingSimilar = ({ read, threshold }: { read: number; threshold: number }) => {
    const newComparison = useNewComparison();

    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/12 text-primary">
                <CheckIcon aria-hidden="true" className="size-[26px]" strokeWidth={2.4} />
            </span>
            <h2 className="font-semibold text-[22px] tracking-[-0.02em]">No similar files found</h2>
            <p className="max-w-[440px] text-[#A1A1AA] text-sm leading-normal">{uniqueLine(read, threshold)}</p>
            <Button
                onClick={newComparison}
                className="mt-1.5 h-10 rounded-lg px-[18px] font-semibold text-[#1A2E05] text-sm hover:bg-[#BEF264]/90"
            >
                New comparison
            </Button>
        </div>
    );
};

/**
 * The groups screen (6b/6c): the toolbar with Back, New comparison, the summary and the marking buttons, then the
 * groups of similar files, each with its best file, and the footer with what is marked for deletion; or the "No similar
 * files found" state.
 */
export const GroupsScreen = () => {
    const result = useScanStore((state) => state.result);
    const heading = useScanStore((state) => state.heading);
    const files = useScanStore((state) => state.files);
    const marks = useScanStore((state) => state.marks);
    const toggleMark = useScanStore((state) => state.toggleMark);
    const setMarks = useScanStore((state) => state.setMarks);
    const clearMarks = useScanStore((state) => state.clearMarks);

    const media = useMemo(() => new Map<string, MediaFile>(files.map((file) => [file.path, file])), [files]);
    const groups = useMemo(
        () => (result?.groups ?? []).map(({ files }): GroupView => ({ files, best: bestIndex(files) })),
        [result],
    );
    const marked = useMemo(() => markedFiles(groups, marks), [groups, marks]);

    if (!result || !heading) return null;

    const { count: scanned, threshold } = heading;
    const unreadable = result.skipped.length;
    const grouped = groups.reduce((total, group) => total + group.files.length, 0);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <GroupsToolbar
                summary={summary({ files: grouped, groups: groups.length, scanned, threshold, unreadable })}
                {...(groups.length > 0 && {
                    marking: { onClear: clearMarks, onAutoSelect: () => setMarks(autoSelect(groups)) },
                })}
            />
            {groups.length === 0 ? (
                <NothingSimilar read={scanned - unreadable} threshold={threshold} />
            ) : (
                <>
                    <div className="flex min-h-0 flex-1 flex-wrap content-start gap-4 overflow-y-auto p-6">
                        {groups.map((group, index) => (
                            <GroupCard
                                key={group.files[0]?.path}
                                number={index + 1}
                                group={group}
                                media={media}
                                marks={marks}
                                onToggle={toggleMark}
                                onKeepBestOnly={() => setMarks(keepBestOnly(marks, group))}
                            />
                        ))}
                    </div>
                    <GroupsFooter marked={marked} />
                </>
            )}
        </div>
    );
};
