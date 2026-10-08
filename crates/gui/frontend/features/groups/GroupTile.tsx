import { PlayIcon, StarIcon } from "lucide-react";
import { Thumbnail, TILE_BOUND } from "@/components/Thumbnail";
import type { GroupFile } from "@/ipc/scan";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { detailsLine, fileName, scoreText } from "./format";

type GroupTileProps = {
    file: GroupFile;
    /** The file's identity, which names its thumbnail; without one, the icon of its kind is shown. */
    identity?: string;
    /** Whether the file is its group's best file, which shows the lime ring, the Keep badge and "best". */
    best: boolean;
    /** The file's similarity to the best file, from 0 to 1. */
    score: number;
    /** Whether the tile fills a column of a large group's grid, rather than being 160 px wide. */
    large: boolean;
};

/**
 * One file of a group: its picture, with the Keep badge on the best file and the duration on a video, then its name
 * and score against the best file, and its resolution and size.
 */
export const GroupTile = ({ file, identity, best, score, large }: GroupTileProps) => {
    const name = fileName(file.path);

    return (
        <div data-path={file.path} className={cn("flex min-w-0 flex-col gap-2", !large && "w-40")}>
            <span
                className={cn(
                    "relative block overflow-hidden rounded-[10px] bg-[#18181B]",
                    large ? "aspect-4/3 w-full" : "h-[120px] w-40",
                    best && "ring-2 ring-primary",
                )}
            >
                <Thumbnail key={identity} type={file.type} {...(identity && { identity })} bound={TILE_BOUND} />
                {/* Over the picture, which would otherwise hide an inset border. */}
                {!best && (
                    <span className="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
                )}
                {best && (
                    <span className="absolute top-2 right-2 flex h-[22px] items-center gap-1 rounded-full bg-primary px-2 font-semibold text-[#1A2E05] text-[11px]">
                        <StarIcon aria-hidden="true" className="size-[11px] fill-current stroke-none" />
                        Keep
                    </span>
                )}
                {/* Explicit, since a video under a second lasts 0 and still shows "0:00". */}
                {file.type === "video" && file.duration !== undefined && (
                    <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-[rgba(9,9,11,0.8)] px-1.5 py-0.5 font-mono text-[#FAFAFA] text-[11px]">
                        <PlayIcon aria-hidden="true" className="size-2.5 fill-[#FAFAFA] stroke-none" />
                        {formatDuration(file.duration)}
                    </span>
                )}
            </span>
            <span className="flex flex-col gap-[3px]">
                <span className="flex items-baseline justify-between gap-1.5">
                    <span title={file.path} className="truncate font-mono text-[#E4E4E7] text-xs">
                        {name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-primary">
                        {best ? "best" : scoreText(score)}
                    </span>
                </span>
                <span className="whitespace-nowrap text-[#A1A1AA] text-[11px]">{detailsLine(file)}</span>
            </span>
        </div>
    );
};
