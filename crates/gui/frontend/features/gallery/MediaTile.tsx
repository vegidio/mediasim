import { memo, useEffect, useState } from "react";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { SHIMMER, Thumbnail, TILE_BOUND } from "@/components/Thumbnail";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo } from "@/ipc/video";
import { formatDuration, formatSize } from "@/lib/format";
import type { Inclusion } from "@/lib/gallery";
import { cn, keepFocus } from "@/lib/utils";
import { useGalleryStore } from "@/stores/gallery";
import { NAME_GAP, PICTURE_HEIGHT, TILE_WIDTH } from "./layout";

/** A tile's box, as the grid lays it out: its picture, then its name row. */
const TILE_STYLE = { width: TILE_WIDTH, gap: NAME_GAP };
const PICTURE_STYLE = { width: TILE_WIDTH, height: PICTURE_HEIGHT };

/** How long a video tile must stay shown before its duration is read, so a fast scroll past it reads nothing. */
export const DURATION_DWELL_MS = 150;

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
    /** The tile's id, which the grid names as its active descendant while the tile is selected. */
    id: string;
    file: MediaFile;
    /** Whether the tile is the grid's selected one, which shows the lime ring and the Open chip. */
    selected: boolean;
    /** Select the tile of the file at `path`, as a click anywhere on it does. */
    onSelect: (path: string) => void;
    /** Whether the file is in the comparison; a left-out or removed file stays in place, dimmed. */
    inclusion: Inclusion;
};

const TOOLTIPS: Partial<Record<Inclusion, string>> = {
    removed: "Removed from this comparison",
    "left-out": "Not included in this comparison",
};

/**
 * One file of the gallery, a cell of its grid: its picture, with a play mark and duration for a video, then its name
 * and size. A click selects it. Its one button is the "Open" chip, which opens the file's media details, as does a
 * double click anywhere on the tile; the keyboard reaches it through the grid, which opens the selected tile on Enter.
 * Memoized, since the virtualized grid re-renders every shown tile on each scroll frame.
 */
export const MediaTile = memo(({ id, file, selected, onSelect, inclusion }: MediaTileProps) => {
    const duration = useDuration(file);
    const tooltip = TOOLTIPS[inclusion];
    // The ring stays bright on a dimmed tile, so only the picture's contents and the text below it are dimmed.
    const dimmed = inclusion !== "included" && "opacity-28 grayscale";
    const openDetails = useGalleryStore((state) => state.openDetails);
    const open = () => openDetails(file.path);

    return (
        // The grid handles the keys for the selected tile, its active descendant; the tile itself never takes focus,
        // and sits in a row of absolutely placed tiles, which table elements can't be.
        // biome-ignore lint/a11y/useKeyWithClickEvents: see above.
        // biome-ignore lint/a11y/useFocusableInteractive: see above.
        // biome-ignore lint/a11y/useSemanticElements: see above.
        <div
            id={id}
            role="gridcell"
            aria-selected={selected}
            data-path={file.path}
            onClick={() => onSelect(file.path)}
            onDoubleClick={open}
            {...(tooltip && { title: tooltip })}
            style={TILE_STYLE}
            className="group flex flex-col text-left"
        >
            <span
                style={PICTURE_STYLE}
                className={cn("relative block overflow-hidden rounded-[10px]", selected && "ring-2 ring-primary")}
            >
                <span className={cn("absolute inset-0 bg-muted", dimmed)}>
                    <Thumbnail key={file.identity} type={file.type} identity={file.identity} bound={TILE_BOUND} />
                    {/* Over the picture, which would otherwise hide an inset border. */}
                    {!selected && (
                        <span className="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" />
                    )}
                    {file.type === "video" && (
                        <>
                            <span className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[rgba(9,9,11,0.6)]">
                                <PlayIcon aria-hidden="true" className="size-4 fill-foreground stroke-none" />
                            </span>
                            {duration !== undefined && (
                                <span className="absolute right-2 bottom-2 rounded-md bg-[rgba(9,9,11,0.8)] px-[7px] py-0.5 font-medium font-mono text-foreground text-[11px]">
                                    {formatDuration(duration)}
                                </span>
                            )}
                        </>
                    )}
                </span>
                {/* Transparent rather than hidden, so it stays in the accessibility tree. Out of the tab order, and kept
                    from taking focus on a press, so focus stays on the grid; its click still selects the tile. */}
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Open ${file.name}`}
                    onMouseDown={keepFocus}
                    onClick={open}
                    className={cn(
                        "absolute top-2 right-2 flex h-[26px] items-center gap-[5px] rounded-md bg-[rgba(9,9,11,0.8)] px-[9px] font-medium text-foreground text-xs opacity-0 outline-none group-hover:opacity-100",
                        selected && "opacity-100",
                    )}
                >
                    <ExternalLinkIcon aria-hidden="true" className="size-[13px]" />
                    Open
                </button>
            </span>
            <span className={cn("flex items-baseline justify-between gap-2", dimmed)}>
                <span className="truncate font-mono text-text-label text-xs">{file.name}</span>
                <span className="whitespace-nowrap text-muted-foreground text-[11px]">{formatSize(file.size)}</span>
            </span>
        </div>
    );
});

/** A tile's place while the files are read: a shimmering picture and two shimmering bars. */
export const PlaceholderTile = () => (
    <div data-testid="placeholder-tile" aria-hidden="true" style={TILE_STYLE} className="flex flex-col">
        <span style={PICTURE_STYLE} className={cn("block rounded-[10px]", SHIMMER)} />
        <span className="flex items-center justify-between gap-2">
            <span className={cn("block h-3 w-24 rounded", SHIMMER)} />
            <span className={cn("block h-3 w-10 rounded", SHIMMER)} />
        </span>
    </div>
);
