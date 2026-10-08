import {
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { inclusion } from "./derive";
import { MediaTile, PlaceholderTile } from "./MediaTile";
import { isArrow, move } from "./navigate";

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

/** The width of the content inside `element`, without its padding or scrollbar. */
const contentWidth = (element: HTMLElement) => element.clientWidth - 2 * PADDING;

type VirtualRowsProps = {
    scroller?: HTMLDivElement;
    count: number;
    columns: number;
    /** The tiles of row `index`. */
    row: (index: number, columns: number) => ReactNode;
    /** A row to scroll into view, if it isn't already; each new request scrolls again. */
    reveal?: { row: number };
    /** The selected tile, which the scroller names as its active descendant while its row is rendered. */
    active?: { row: number; id: string };
};

/** Only the rows in view, and two either side, of `count` tiles in `columns` columns. */
const VirtualRows = ({ scroller, count, columns, row, reveal, active }: VirtualRowsProps) => {
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
        if (reveal) virtualizer.scrollToIndex(reveal.row, { align: "auto" });
    }, [virtualizer, reveal]);

    const items = virtualizer.getVirtualItems();
    // A scroll can take the selected row out of the DOM; the scroller must not name a tile that isn't there.
    const descendant = active && items.some(({ index }) => index === active.row) ? active.id : undefined;

    useLayoutEffect(() => {
        if (!scroller) return;
        if (descendant) scroller.setAttribute("aria-activedescendant", descendant);
        else scroller.removeAttribute("aria-activedescendant");
    }, [scroller, descendant]);

    return (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {items.map(({ key, index, start }) => (
                // Rows of absolutely placed tiles, which table elements can't be; the grid holds focus, not the rows.
                // biome-ignore lint/a11y/useSemanticElements: see above.
                // biome-ignore lint/a11y/useFocusableInteractive: see above.
                <div
                    key={key}
                    role="row"
                    aria-rowindex={index + 1}
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

/**
 * The set's files as tiles in centred columns that fit the width, with placeholders while they are read. The grid is a
 * single tab stop: it keeps keyboard focus itself, and the arrow keys, Enter, Space and Escape act on its selected tile.
 */
export const GalleryGrid = () => {
    const listing = useGalleryStore((state) => state.listing);
    const filter = useGalleryStore((state) => state.filter);
    const overrides = useGalleryStore((state) => state.overrides);
    const load = useGalleryStore((state) => state.load);
    const selected = useGalleryStore((state) => state.selected);
    const select = useGalleryStore((state) => state.select);
    const clearSelection = useGalleryStore((state) => state.clearSelection);
    const openDetails = useGalleryStore((state) => state.openDetails);
    const toggle = useGalleryStore((state) => state.toggle);
    const focusGrid = useGalleryStore((state) => state.focusGrid);
    const gridFocused = useGalleryStore((state) => state.gridFocused);
    const total = useHomeStore((state) => state.view.total);
    const [scroller, setScroller] = useState<HTMLDivElement>();
    const [columns, setColumns] = useState(1);
    const [reveal, setReveal] = useState<{ row: number }>();
    // Whether the grid's next focus comes from a press on it or from the app, so it isn't taken for tabbing in.
    const quiet = useRef(false);
    const tileId = useId();

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

    const files = listing.status === "ready" ? listing.files : undefined;
    const selectedIndex = selected ? (files?.findIndex((file) => file.path === selected) ?? -1) : -1;

    // As after the details close, or a click on a filter tab: the grid takes focus, without selecting a tile.
    useEffect(() => {
        if (!focusGrid || !scroller) return;

        if (focusGrid.reveal && selectedIndex >= 0) setReveal({ row: Math.floor(selectedIndex / columns) });
        quiet.current = document.activeElement !== scroller;
        scroller.focus({ preventScroll: true });
        gridFocused();
    }, [focusGrid, scroller, selectedIndex, columns, gridFocused]);

    /** Select the tile at `index`, scrolling its row into view. */
    const selectAt = (index: number) => {
        const file = files?.[index];
        if (!file) return;
        select(file.path);
        setReveal({ row: Math.floor(index / columns) });
    };

    const onFocus = (event: FocusEvent<HTMLDivElement>) => {
        const tabbedIn = event.target === event.currentTarget && !quiet.current;
        quiet.current = false;
        if (tabbedIn && !useGalleryStore.getState().selected) selectAt(0);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!files) return;
        const { key } = event;

        if (isArrow(key)) {
            event.preventDefault();
            selectAt(selectedIndex < 0 ? 0 : move(key, selectedIndex, files.length, columns));
        } else if (key === " ") {
            // Space would scroll the grid otherwise.
            event.preventDefault();
            if (selected) toggle(selected);
        } else if (key === "Enter") {
            if (!selected) return;
            // The dialog opens and focuses its first button within this event; left alone, the browser would then
            // press that button with this same Enter, stepping to the previous file.
            event.preventDefault();
            openDetails(selected);
        } else if (key === "Escape") {
            clearSelection();
        }
    };

    const onClick = (event: MouseEvent<HTMLDivElement>) => {
        const { target, currentTarget, nativeEvent } = event;
        // A press on the scrollbar is not a click on the grid's empty space.
        if (target === currentTarget && nativeEvent.offsetX >= currentTarget.clientWidth) return;
        if (target instanceof Element && target.closest("[data-path]")) return;
        clearSelection();
    };

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

    return (
        // The selected tile's ring is the focus indicator, so the grid draws none of its own. A table can't hold the
        // virtualized rows.
        // biome-ignore lint/a11y/useSemanticElements: see above.
        <div
            ref={observe}
            data-testid="gallery-grid"
            role="grid"
            aria-label="Files"
            aria-rowcount={Math.ceil((files?.length ?? total) / columns)}
            aria-colcount={columns}
            aria-busy={!files}
            tabIndex={0}
            onFocus={onFocus}
            onBlur={() => {
                quiet.current = false;
            }}
            onPointerDown={() => {
                quiet.current = true;
            }}
            onKeyDown={onKeyDown}
            onClick={onClick}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none"
            style={{ paddingInline: PADDING }}
        >
            {files ? (
                <VirtualRows
                    {...(scroller && { scroller })}
                    count={files.length}
                    columns={columns}
                    {...(reveal && { reveal })}
                    {...(selectedIndex >= 0 && {
                        active: { row: Math.floor(selectedIndex / columns), id: `${tileId}${selectedIndex}` },
                    })}
                    row={(index, columns) =>
                        files.slice(index * columns, (index + 1) * columns).map((file, column) => {
                            const at = index * columns + column;
                            return (
                                <MediaTile
                                    key={file.path}
                                    id={`${tileId}${at}`}
                                    file={file}
                                    selected={at === selectedIndex}
                                    onSelect={() => {
                                        select(file.path);
                                        scroller?.focus({ preventScroll: true });
                                    }}
                                    inclusion={inclusion(file.type, filter, overrides.has(file.path))}
                                />
                            );
                        })
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
