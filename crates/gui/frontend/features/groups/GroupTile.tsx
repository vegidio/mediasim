import type { KeyboardEvent } from "react";
import { PlayIcon, StarIcon, Trash2Icon } from "lucide-react";
import { Thumbnail, TILE_BOUND } from "@/components/Thumbnail";
import { Checkbox } from "@/components/ui/checkbox";
import type { GroupFile } from "@/ipc/scan";
import { fileName, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { detailsLine } from "./format";

type GroupTileProps = {
    file: GroupFile;
    /** The file's identity, which names its thumbnail; without one, the icon of its kind is shown. */
    identity?: string;
    /** Whether the file is its group's best file, which shows the Best badge. */
    best: boolean;
    /** Whether the tile fills a column of a large group's grid, rather than being 160 px wide. */
    large: boolean;
    /** Whether the file is marked for deletion, which shows the red ring, the wash, the Delete badge and a struck name. */
    marked: boolean;
    /** Marks the file at `path`, or unmarks it when it is marked. */
    onToggle: (path: string) => void;
    /** Whether the tile is the screen's selected one, which shows the lime ring. */
    selected: boolean;
    /** Whether the thumbnail is the groups area's stop in the tab order. */
    tabbable: boolean;
    /** Selects the tile of the file at `path`. */
    onSelect: (path: string) => void;
    /** Opens the details of the file at `path`. */
    onOpen: (path: string) => void;
    /** Handles a key pressed on the thumbnail of the file at `path`. */
    onKey: (path: string, event: KeyboardEvent) => void;
};

/**
 * One file of a group, taking callbacks by path so an unchanged tile skips re-rendering: its picture, which selects the tile on a click and opens its details on a double click, with
 * its mark checkbox, the Best or Delete badge and the duration on a video, then its name and its resolution and size.
 */
export const GroupTile = ({
    file,
    identity,
    best,
    large,
    marked,
    onToggle,
    selected,
    tabbable,
    onSelect,
    onOpen,
    onKey,
}: GroupTileProps) => {
    const name = fileName(file.path);

    return (
        <div data-path={file.path} className={cn("flex min-w-0 flex-col gap-2", !large && "w-40")}>
            <span
                className={cn(
                    "relative block overflow-hidden rounded-[10px] bg-[#18181B]",
                    large ? "aspect-4/3 w-full" : "h-[120px] w-40",
                    selected ? "ring-2 ring-primary" : marked && "ring-2 ring-[#EF4444]",
                )}
            >
                {/* Its focus ring is the selection ring, since focus follows the selection. */}
                <button
                    type="button"
                    aria-label={name}
                    aria-current={selected || undefined}
                    data-select={file.path}
                    tabIndex={tabbable ? 0 : -1}
                    onFocus={() => onSelect(file.path)}
                    onClick={(event) => {
                        onSelect(file.path);
                        // WebKit, the macOS webview, doesn't focus a button on click.
                        event.currentTarget.focus();
                    }}
                    onDoubleClick={() => onOpen(file.path)}
                    onKeyDown={(event) => onKey(file.path, event)}
                    className="absolute inset-0 block cursor-pointer p-0 outline-none"
                >
                    <Thumbnail key={identity} type={file.type} {...(identity && { identity })} bound={TILE_BOUND} />
                </button>
                {marked && <span className="pointer-events-none absolute inset-0 bg-[rgba(69,10,10,0.62)]" />}
                {/* Over the picture, which would otherwise hide an inset border. */}
                {!selected && !marked && (
                    <span className="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
                )}
                {marked ? (
                    <span className="pointer-events-none absolute top-2 right-2 flex h-[22px] items-center gap-1 rounded-full bg-[#DC2626] px-2 font-semibold text-[11px] text-white">
                        <Trash2Icon aria-hidden="true" className="size-[11px]" />
                        Delete
                    </span>
                ) : (
                    best && (
                        <span className="pointer-events-none absolute top-2 right-2 flex h-[22px] items-center gap-1 rounded-full bg-primary px-2 font-semibold text-[#1A2E05] text-[11px]">
                            <StarIcon aria-hidden="true" className="size-[11px] fill-current stroke-none" />
                            Best
                        </span>
                    )
                )}
                {/* Explicit, since a video under a second lasts 0 and still shows "0:00". */}
                {file.type === "video" && file.duration !== undefined && (
                    <span className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-[rgba(9,9,11,0.8)] px-1.5 py-0.5 font-mono text-[#FAFAFA] text-[11px]">
                        <PlayIcon aria-hidden="true" className="size-2.5 fill-[#FAFAFA] stroke-none" />
                        {formatDuration(file.duration)}
                    </span>
                )}
                <Checkbox
                    checked={marked}
                    onCheckedChange={() => onToggle(file.path)}
                    tabIndex={-1}
                    aria-label={`Mark ${name} for deletion`}
                    className="absolute top-2 left-2 size-6 rounded-md border-[1.5px] border-[rgba(250,250,250,0.7)] bg-[rgba(9,9,11,0.55)] dark:bg-[rgba(9,9,11,0.55)] data-checked:border data-checked:border-[#DC2626] data-checked:bg-[#DC2626] data-checked:text-white dark:data-checked:bg-[#DC2626] [&_svg]:stroke-3"
                />
            </span>
            <span className="flex flex-col gap-[3px]">
                <span
                    title={file.path}
                    className={cn(
                        "truncate font-mono text-xs",
                        marked ? "text-[#A1A1AA] line-through" : "text-[#E4E4E7]",
                    )}
                >
                    {name}
                </span>
                <span className="whitespace-nowrap text-[#A1A1AA] text-[11px]">{detailsLine(file)}</span>
            </span>
        </div>
    );
};
