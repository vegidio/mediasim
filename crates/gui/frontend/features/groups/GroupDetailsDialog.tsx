import { StarIcon, Trash2Icon } from "lucide-react";
import { DetailsDialog } from "@/features/details/DetailsDialog";
import { Chip, kindLabel } from "@/features/details/DetailsSidebar";
import { indexOfPath } from "@/features/details/navigate";
import type { MediaFile } from "@/ipc/thumbs";
import type { GroupView } from "@/lib/marks";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/stores/scan";
import { groupPosition } from "./format";

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
                    <Chip>{kindLabel(file.type)}</Chip>
                    {best && (
                        <Chip className="gap-1 border-transparent bg-primary font-semibold text-primary-foreground">
                            <StarIcon aria-hidden="true" className="size-[11px] fill-current stroke-none" />
                            Recommended keep
                        </Chip>
                    )}
                    {marked && (
                        <Chip className="border-transparent bg-danger font-semibold text-white">
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
                            ? "border-danger bg-danger text-white hover:bg-danger-hover"
                            : "border-danger-border bg-transparent text-danger-soft hover:bg-[rgba(127,29,29,0.25)]",
                    )}
                >
                    <Trash2Icon aria-hidden="true" className="size-[15px]" />
                    {marked ? "Unmark" : "Mark for deletion"}
                </button>
            }
        />
    );
};
