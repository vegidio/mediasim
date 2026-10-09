import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { MediaFile } from "@/ipc/thumbs";
import type { GroupView } from "@/lib/marks";
import { cn, keepFocus } from "@/lib/utils";
import { groupSize } from "./format";
import { GroupTile } from "./GroupTile";

/** The number of files from which a group spans the full width: the fewest whose small tiles overflow a 1280 px window. */
const LARGE_GROUP = 7;

type GroupCardProps = {
    /** The group's number, from 1. */
    number: number;
    group: GroupView;
    /** The scanned files by path, for their thumbnails. */
    media: ReadonlyMap<string, MediaFile>;
    /** Marks the file at `path`, or unmarks it when it is marked. */
    onToggle: (path: string) => void;
    /** Unmarks the group's best file and marks every other file of it. */
    onKeepBestOnly: () => void;
    /** The path of the screen's selected file, in any group. */
    selected?: string;
    /** The path of the file whose thumbnail is the groups area's stop in the tab order, in any group. */
    tabbable?: string;
    /** Selects the file at `path`. */
    onSelect: (path: string) => void;
    /** Opens the details of the file at `path`. */
    onOpen: (path: string) => void;
    /** Handles a key pressed on the thumbnail of the file at `path`. */
    onKey: (path: string, event: KeyboardEvent) => void;
};

/**
 * One group of similar files: its number, size and "Keep best only", then its files, in a row or, from 7 files, in an
 * 8-column grid.
 */
export const GroupCard = ({
    number,
    group: { files, best },
    media,
    onToggle,
    onKeepBestOnly,
    selected,
    tabbable,
    onSelect,
    onOpen,
    onKey,
}: GroupCardProps) => {
    const large = files.length >= LARGE_GROUP;
    const type = files[0]?.type ?? "image";

    return (
        <section
            aria-label={`Group ${number}`}
            className={cn(
                "flex flex-col gap-3.5 rounded-[14px] border border-border bg-card px-5 pt-4 pb-5",
                large && "w-full",
            )}
        >
            <div className="flex items-center gap-2.5">
                <span className="font-semibold text-sm">Group {number}</span>
                <span className="text-muted-foreground text-[13px]">{groupSize(files.length, type)}</span>
                <span className="flex-1" />
                <Button
                    variant="outline"
                    onClick={onKeepBestOnly}
                    onMouseDown={keepFocus}
                    className="h-7 rounded-md border-border bg-transparent px-2.5 font-medium text-text-label text-xs dark:border-border dark:bg-transparent"
                >
                    Keep best only
                </Button>
            </div>
            <div className={cn(large ? "grid grid-cols-8 gap-x-3 gap-y-4" : "flex gap-3")}>
                {files.map((file, index) => {
                    const identity = media.get(file.path)?.identity;
                    return (
                        <GroupTile
                            key={file.path}
                            file={file}
                            {...(identity && { identity })}
                            best={index === best}
                            large={large}
                            onToggle={onToggle}
                            selected={file.path === selected}
                            tabbable={file.path === tabbable}
                            onSelect={onSelect}
                            onOpen={onOpen}
                            onKey={onKey}
                        />
                    );
                })}
            </div>
        </section>
    );
};
