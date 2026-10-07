import { useEffect, useState } from "react";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { MediaKindIcon } from "@/components/MediaKindIcon";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import { formatDuration, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The longest edge, in pixels, a tile's picture is asked for. A 160×120 tile on a 2× display needs 320×240 covered,
 * which a 16:9 or 3:4 picture fitted to 512 does.
 */
export const TILE_BOUND = 512;

/** How long a video tile must stay shown before its duration is read, so a fast scroll past it reads nothing. */
export const DURATION_DWELL_MS = 150;

/** A light sweeping across a dark placeholder, while something loads. */
const SHIMMER =
    "animate-shimmer bg-[linear-gradient(90deg,#1F1F23_0%,#2E2E33_50%,#1F1F23_100%)] bg-size-[200%_100%] motion-reduce:animate-none";

/** A file's picture filling its tile: a shimmer while it loads, the icon of its kind if it can't be produced. */
const Thumbnail = ({ file }: { file: MediaFile }) => {
    const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");

    return (
        <>
            {state === "loading" && <span data-testid="shimmer" className={cn("absolute inset-0", SHIMMER)} />}
            {state === "failed" && (
                <span className="absolute inset-0 flex items-center justify-center text-muted-foreground [&_svg]:size-[22px]">
                    <MediaKindIcon type={file.type} />
                </span>
            )}
            {/* Decorative: the tile is named after the file. */}
            <img
                alt=""
                src={renditionUrl(file.identity, TILE_BOUND)}
                decoding="async"
                onLoad={() => setState("loaded")}
                onError={() => setState("failed")}
                className={cn("absolute inset-0 size-full object-cover", state !== "loaded" && "invisible")}
            />
        </>
    );
};

/** A video's duration in seconds, read once the tile has been shown for a moment; `undefined` until then or on failure. */
const useDuration = (file: MediaFile) => {
    const [duration, setDuration] = useState<number>();
    const { type, identity } = file;

    useEffect(() => {
        if (type !== "video") return;

        let live = true;
        const timer = setTimeout(() => {
            probeVideo(identity).then(
                (probe) => live && setDuration(probe.duration),
                // No badge: the duration simply isn't shown.
                () => {},
            );
        }, DURATION_DWELL_MS);

        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [type, identity]);

    return duration;
};

type MediaTileProps = {
    file: MediaFile;
    /** Whether the selected tab includes this file; a left-out file stays in place, dimmed. */
    included: boolean;
};

/** One file of the gallery: its picture, with a play mark and duration for a video, then its name and size. */
export const MediaTile = ({ file, included }: MediaTileProps) => {
    const duration = useDuration(file);

    return (
        // Activating it does nothing until media details exist.
        <button
            type="button"
            aria-label={`Open ${file.name}`}
            {...(!included && { title: "Not included in this comparison" })}
            className={cn("group flex w-40 flex-col gap-2 text-left outline-none", !included && "opacity-28 grayscale")}
        >
            <span className="relative block h-[120px] w-40 overflow-hidden rounded-[10px] bg-[#18181B] group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-2 group-focus-visible:ring-primary">
                <Thumbnail key={file.identity} file={file} />
                {/* Over the picture, which would otherwise hide an inset border. */}
                <span className="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] group-hover:hidden group-focus-visible:hidden" />
                {file.type === "video" && (
                    <>
                        <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(9,9,11,0.6)]">
                            <PlayIcon aria-hidden="true" className="size-4 fill-[#FAFAFA] stroke-none" />
                        </span>
                        {duration !== undefined && (
                            <span className="absolute right-2 bottom-2 rounded-md bg-[rgba(9,9,11,0.8)] px-[7px] py-0.5 font-medium font-mono text-[#FAFAFA] text-[11px]">
                                {formatDuration(duration)}
                            </span>
                        )}
                    </>
                )}
                <span
                    aria-hidden="true"
                    className="absolute top-2 right-2 hidden h-[26px] items-center gap-[5px] rounded-md bg-[rgba(9,9,11,0.8)] px-[9px] font-medium text-[#FAFAFA] text-xs group-hover:flex group-focus-visible:flex"
                >
                    <ExternalLinkIcon className="size-[13px]" />
                    Open
                </span>
            </span>
            <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[#E4E4E7] text-xs">{file.name}</span>
                <span className="whitespace-nowrap text-[#A1A1AA] text-[11px]">{formatSize(file.size)}</span>
            </span>
        </button>
    );
};

/** A tile's place while the files are read: a shimmering picture and two shimmering bars. */
export const PlaceholderTile = () => (
    <div data-testid="placeholder-tile" aria-hidden="true" className="flex w-40 flex-col gap-2">
        <span className={cn("block h-[120px] w-40 rounded-[10px]", SHIMMER)} />
        <span className="flex items-center justify-between gap-2">
            <span className={cn("block h-3 w-24 rounded", SHIMMER)} />
            <span className={cn("block h-3 w-10 rounded", SHIMMER)} />
        </span>
    </div>
);
