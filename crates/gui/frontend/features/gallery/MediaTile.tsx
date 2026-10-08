import { useEffect, useState } from "react";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { MediaKindIcon } from "@/components/MediaKindIcon";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import { formatDuration, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useGalleryStore } from "@/stores/gallery";

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
    /** Whether the file was removed from the comparison; it stays in place too, dimmed. */
    removed?: boolean;
};

/**
 * One file of the gallery: its picture, with a play mark and duration for a video, then its name and size. Its one
 * button is the "Open" chip, which opens the file's media details, as does a double click anywhere on the tile.
 */
export const MediaTile = ({ file, included, removed }: MediaTileProps) => {
    const duration = useDuration(file);
    const tooltip = removed
        ? "Removed from this comparison"
        : !included
          ? "Not included in this comparison"
          : undefined;
    const openDetails = useGalleryStore((state) => state.openDetails);
    const open = () => openDetails(file.path);

    return (
        // The double click is a shortcut for the pointer; the Open button is the way in from the keyboard.
        // biome-ignore lint/a11y/noStaticElementInteractions: the tile's button is its Open chip, which a button can't hold.
        <div
            data-path={file.path}
            onDoubleClick={open}
            {...(tooltip && { title: tooltip })}
            className={cn("group flex w-40 flex-col gap-2 text-left", (!included || removed) && "opacity-28 grayscale")}
        >
            <span className="relative block h-[120px] w-40 overflow-hidden rounded-[10px] bg-[#18181B] group-hover:ring-2 group-hover:ring-primary group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-primary">
                <Thumbnail key={file.identity} file={file} />
                {/* Over the picture, which would otherwise hide an inset border. */}
                <span className="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] group-hover:hidden group-has-[:focus-visible]:hidden" />
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
                {/* Transparent rather than hidden, so it stays in the tab order and the accessibility tree. */}
                <button
                    type="button"
                    aria-label={`Open ${file.name}`}
                    onClick={open}
                    className="absolute top-2 right-2 flex h-[26px] items-center gap-[5px] rounded-md bg-[rgba(9,9,11,0.8)] px-[9px] font-medium text-[#FAFAFA] text-xs opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100"
                >
                    <ExternalLinkIcon aria-hidden="true" className="size-[13px]" />
                    Open
                </button>
            </span>
            <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[#E4E4E7] text-xs">{file.name}</span>
                <span className="whitespace-nowrap text-[#A1A1AA] text-[11px]">{formatSize(file.size)}</span>
            </span>
        </div>
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
