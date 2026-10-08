import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { isIncluded } from "./derive";
import { MediaTile, PlaceholderTile } from "./MediaTile";

/** A tile's width, in pixels. */
const TILE_WIDTH = 160;
/** The space between columns, in pixels. */
const COLUMN_GAP = 12;
/** The space between rows, in pixels. */
const ROW_GAP = 20;
/** A row's height with the gap below it: the 120 px picture, an 8 px gap, the 16 px name row, then the row gap. */
const ROW_HEIGHT = 120 + 8 + 16 + ROW_GAP;
/** The grid's padding on every side, in pixels. */
const PADDING = 24;

/** How many tiles fit across `width` pixels of content, never fewer than one. */
export const columnsFor = (width: number) => Math.max(1, Math.floor((width + COLUMN_GAP) / (TILE_WIDTH + COLUMN_GAP)));

/** How many frames the grid waits for a tile it scrolled to before giving up on focusing it. */
const FOCUS_FRAMES = 10;

/** The Open button of the tile for the file at `path`, if the grid renders it. */
const openButton = (scroller: HTMLElement, path: string) =>
    Array.from(scroller.querySelectorAll<HTMLElement>("[data-path]"))
        .find((tile) => tile.dataset.path === path)
        ?.querySelector("button");

/** The width of the content inside `element`, without its padding or scrollbar. */
const contentWidth = (element: HTMLElement) => element.clientWidth - 2 * PADDING;

type VirtualRowsProps = {
    scroller?: HTMLDivElement;
    count: number;
    columns: number;
    /** The tiles of row `index`. */
    row: (index: number, columns: number) => ReactNode;
    /** A row to scroll into view, if it isn't already. */
    reveal?: number;
};

/** Only the rows in view, and two either side, of `count` tiles in `columns` columns. */
const VirtualRows = ({ scroller, count, columns, row, reveal }: VirtualRowsProps) => {
    // The virtualizer is one mutable object that rerenders through its own state, which the compiler can't follow.
    "use no memo";

    const virtualizer = useVirtualizer({
        count: Math.ceil(count / columns),
        getScrollElement: () => scroller ?? null,
        estimateSize: () => ROW_HEIGHT,
        overscan: 2,
        paddingStart: PADDING,
        // The last row's gap stands for part of the bottom padding.
        paddingEnd: PADDING - ROW_GAP,
    });

    useEffect(() => {
        if (reveal !== undefined) virtualizer.scrollToIndex(reveal, { align: "auto" });
    }, [virtualizer, reveal]);

    return (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(({ key, index, start }) => (
                <div
                    key={key}
                    className="absolute top-0 left-0 flex w-full justify-center"
                    style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
                >
                    {/* The full row's width, so a short last row lines up under the others. */}
                    <div className="flex gap-3" style={{ width: columns * TILE_WIDTH + (columns - 1) * COLUMN_GAP }}>
                        {row(index, columns)}
                    </div>
                </div>
            ))}
        </div>
    );
};

/** The set's files as tiles in centred columns that fit the width, with placeholders while they are read. */
export const GalleryGrid = () => {
    const listing = useGalleryStore((state) => state.listing);
    const filter = useGalleryStore((state) => state.filter);
    const removed = useGalleryStore((state) => state.removed);
    const load = useGalleryStore((state) => state.load);
    const focusTile = useGalleryStore((state) => state.focusTile);
    const tileFocused = useGalleryStore((state) => state.tileFocused);
    const total = useHomeStore((state) => state.view.total);
    const [scroller, setScroller] = useState<HTMLDivElement>();
    const [columns, setColumns] = useState(1);

    // A callback ref, so the grid is measured again whenever it comes back, as after "Try again". It must stay the same
    // function across renders, or React would detach and reattach it, and the observer with it, on every render.
    const observe = useCallback((element: HTMLDivElement) => {
        setScroller(element);
        const measure = () => setColumns(columnsFor(contentWidth(element)));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);

        return () => {
            observer.disconnect();
            setScroller(undefined);
        };
    }, []);

    // Once its row is rendered, which can take a frame or two after scrolling to it.
    useEffect(() => {
        if (focusTile === undefined || !scroller) return;

        let frame = 0;
        let frames = 0;
        const attempt = () => {
            const button = openButton(scroller, focusTile);
            if (!button && ++frames < FOCUS_FRAMES) {
                frame = requestAnimationFrame(attempt);
                return;
            }
            button?.focus();
            tileFocused();
        };
        frame = requestAnimationFrame(attempt);

        return () => cancelAnimationFrame(frame);
    }, [focusTile, scroller, tileFocused]);

    if (listing.status === "failed") {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
                <p>Couldn't read the files in this set.</p>
                <Button variant="outline" onClick={() => void load()}>
                    Try again
                </Button>
            </div>
        );
    }

    const files = listing.status === "ready" ? listing.files : undefined;
    const focusIndex = focusTile === undefined ? -1 : (files?.findIndex((file) => file.path === focusTile) ?? -1);

    return (
        <div
            ref={observe}
            data-testid="gallery-grid"
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
            style={{ paddingInline: PADDING }}
        >
            {files ? (
                <VirtualRows
                    {...(scroller && { scroller })}
                    count={files.length}
                    columns={columns}
                    {...(focusIndex >= 0 && { reveal: Math.floor(focusIndex / columns) })}
                    row={(index, columns) =>
                        files
                            .slice(index * columns, (index + 1) * columns)
                            .map((file) => (
                                <MediaTile
                                    key={file.path}
                                    file={file}
                                    included={isIncluded(file.type, filter)}
                                    removed={removed.has(file.path)}
                                />
                            ))
                    }
                />
            ) : (
                <VirtualRows
                    {...(scroller && { scroller })}
                    count={total}
                    columns={columns}
                    row={(index, columns) =>
                        Array.from({ length: Math.min(columns, total - index * columns) }, (_, column) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: a placeholder is identified by its position alone.
                            <PlaceholderTile key={column} />
                        ))
                    }
                />
            )}
        </div>
    );
};
