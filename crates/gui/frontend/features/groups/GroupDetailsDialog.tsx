import { StarIcon, Trash2Icon } from "lucide-react";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/stores/scan";
import { DetailsDialog } from "../details/DetailsDialog";
import { Chip, kindLabel } from "../details/DetailsSidebar";
import { indexOfPath } from "../details/navigate";
import { groupPosition } from "./format";
import type { GroupView } from "./GroupCard";

const MARK_BUTTON =
    "flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-lg border font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary";

type GroupDetailsDialogProps = {
    /** The group's number on the groups screen, from 1. */
    number: number;
    group: GroupView;
    /** The group's scanned files, in the card's order. */
    files: readonly MediaFile[];
    /** The one to show, which is one of `files`. */
    file: MediaFile;
    /** Shows the group's file at `path`. */
    onShow: (path: string) => void;
    onClose: () => void;
    /** Puts focus back on the groups screen, once the dialog has closed. */
    onClosed: () => void;
};

/**
 * The media details of one of a group's files over the dimmed groups screen (7), stepping through its group only, with
 * "Recommended keep" on the best file and the button that marks the file for deletion or unmarks it.
 */
export const GroupDetailsDialog = ({
    number,
    group,
    files,
    file,
    onShow,
    onClose,
    onClosed,
}: GroupDetailsDialogProps) => {
    const marks = useScanStore((state) => state.marks);
    const toggleMark = useScanStore((state) => state.toggleMark);
    const marked = marks.has(file.path);
    const best = group.files[group.best]?.path === file.path;

    return (
        <DetailsDialog
            files={files}
            file={file}
            position={groupPosition(number, indexOfPath(files, file.path), files.length)}
            onShow={(target) => onShow(target.path)}
            onClose={onClose}
            onClosed={onClosed}
            onToggle={() => toggleMark(file.path)}
            marks={marks}
            chips={
                <>
                    {best && (
                        <Chip className="gap-1 border-transparent bg-primary font-semibold text-[#1A2E05]">
                            <StarIcon aria-hidden="true" className="size-[11px] fill-current stroke-none" />
                            Recommended keep
                        </Chip>
                    )}
                    <Chip>{kindLabel(file.type)}</Chip>
                    {marked && (
                        <Chip className="border-transparent bg-[#DC2626] font-semibold text-white">
                            Marked for deletion
                        </Chip>
                    )}
                </>
            }
            action={
                <button
                    type="button"
                    onClick={() => toggleMark(file.path)}
                    className={cn(
                        MARK_BUTTON,
                        marked
                            ? "border-[#DC2626] bg-[#DC2626] text-white hover:bg-[#B91C1C]"
                            : "border-[#7F1D1D] bg-transparent text-[#FCA5A5] hover:bg-[rgba(127,29,29,0.25)]",
                    )}
                >
                    <Trash2Icon aria-hidden="true" className="size-[15px]" />
                    {marked ? "Unmark" : "Mark for deletion"}
                </button>
            }
        />
    );
};
