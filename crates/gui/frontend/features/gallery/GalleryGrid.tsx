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
import { inclusion, ordered } from "@/lib/gallery";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { columnsFor, PADDING, ROW_GAP, ROW_HEIGHT, rowWidth, tileOffset } from "./layout";
import { MediaTile, PlaceholderTile } from "./MediaTile";
import { isArrow, move } from "./navigate";
import { useReorderAnimation } from "./useReorderAnimation";

/** The width of the content inside `element`, without its padding or scrollbar. */
const contentWidth = (element: HTMLElement) => element.clientWidth - 2 * PADDING;

type VirtualRowsProps<T> = {
    scroller?: HTMLDivElement;
    /** Every tile, in the grid's order. */
    tiles: readonly T[];
    columns: number;
    /** A tile's key, which keeps its element, and its picture, when it moves to another row. */
    keyOf: (tile: T) => string;
    /** The contents of a tile, at `index` in the grid's order. */
    render: (tile: T, index: number) => ReactNode;
    /** The id of the cell `render` gives the tile at `index`, which its row owns; none for cells that aren't. */
    cellId?: (index: number) => string;
    /** How the tiles are arranged, such as the selected tab; a change slides them to their new places from the top. */
    arrangement?: string;
    /** A row to scroll into view, if it isn't already; each new request scrolls again. */
    reveal?: { row: number };
    /** The selected tile, which the scroller names as its active descendant while its row is rendered. */
    active?: { row: number; id: string };
};

/**
 * Only the rows in view, and two either side, of `tiles` in `columns` columns. Every tile sits in one layer, placed by
 * its index, so a tile that changes rows keeps its element; the rows are empty, and own their tiles for assistive
 * technology.
 */
const VirtualRows = <T,>({
    scroller,
    tiles,
    columns,
    keyOf,
    render,
    cellId,
    arrangement,
    reveal,
    active,
}: VirtualRowsProps<T>) => {
    // The virtualizer is one mutable object that rerenders through its own state, which the compiler can't follow.
    "use no memo";

    const virtualizer = useVirtualizer({
        count: Math.ceil(tiles.length / columns),
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

    const shown = items.flatMap(({ index }) =>
        tiles.slice(index * columns, (index + 1) * columns).map((tile, column) => ({
            key: keyOf(tile),
            tile,
            index: index * columns + column,
        })),
    );
    const { departing, track } = useReorderAnimation({
        ...(arrangement && { arrangement }),
        tiles,
        keyOf,
        columns,
        shown: new Set(shown.map(({ key }) => key)),
        viewTop: virtualizer.scrollOffset ?? 0,
        ...(scroller && { scroller }),
    });

    /** The indices of the tiles in row `row`. */
    const indicesOf = (row: number) =>
        Array.from({ length: Math.min(columns, tiles.length - row * columns) }, (_, column) => row * columns + column);

    // A full row's left edge; a short last row starts there too, so it lines up under the others.
    const left = `calc(50% - ${rowWidth(columns) / 2}px)`;

    return (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {items.map(({ key, index, start }) => (
                // Rows of absolutely placed tiles, which table elements can't be; the grid holds focus, not the rows.
                // biome-ignore lint/a11y/useSemanticElements: see above.
                // biome-ignore lint/a11y/useFocusableInteractive: see above.
                <div
                    key={`row:${key}`}
                    role="row"
                    aria-rowindex={index + 1}
                    {...(cellId && { "aria-owns": indicesOf(index).map(cellId).join(" ") })}
                    className="absolute top-0 left-0 w-full"
                    style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
                />
            ))}
            {[
                ...shown.map((entry) => ({ ...entry, leaving: false })),
                ...departing.map((entry) => ({ ...entry, leaving: true })),
            ].map(({ key, tile, index, leaving }) => {
                const { x, y } = tileOffset(index, columns);
                return (
                    <div
                        key={key}
                        ref={track}
                        data-key={key}
                        // A tile sliding out of view is only a picture of where it went.
                        {...(leaving && { inert: true, "aria-hidden": true })}
                        className="absolute top-0"
                        style={{ left, transform: `translate(${x}px, ${y}px)` }}
                    >
                        {render(tile, index)}
                    </div>
                );
            })}
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

    // The one order the rows, the selection and the keys all follow: the tab's files first.
    const files = listing.status === "ready" ? ordered(listing.files, filter) : undefined;
    const selectedIndex = selected ? (files?.findIndex((file) => file.path === selected) ?? -1) : -1;

    // As after the details close, or a click on a filter tab: the grid takes focus, without selecting a tile.
    useEffect(() => {
        if (!focusGrid || !scroller) return;

        if (focusGrid.reveal && selectedIndex >= 0) setReveal({ row: Math.floor(selectedIndex / columns) });
        quiet.current = document.activeElement !== scroller;
        scroller.focus({ preventScroll: true });
        gridFocused();
    }, [focusGrid, scroller, selectedIndex, columns, gridFocused]);

    /** Select the tile of the file at `path`, as a click on it does, keeping focus on the grid. */
    const selectTile = (path: string) => {
        select(path);
        scroller?.focus({ preventScroll: true });
    };

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
                    key="files"
                    {...(scroller && { scroller })}
                    tiles={files}
                    arrangement={filter}
                    columns={columns}
                    keyOf={(file) => file.path}
                    cellId={(at) => `${tileId}${at}`}
                    {...(reveal && { reveal })}
                    {...(selectedIndex >= 0 && {
                        active: { row: Math.floor(selectedIndex / columns), id: `${tileId}${selectedIndex}` },
                    })}
                    render={(file, at) => (
                        <MediaTile
                            id={`${tileId}${at}`}
                            file={file}
                            selected={at === selectedIndex}
                            onSelect={selectTile}
                            inclusion={inclusion(file.type, filter, overrides.has(file.path))}
                        />
                    )}
                />
            ) : (
                <VirtualRows
                    key="placeholders"
                    {...(scroller && { scroller })}
                    tiles={Array.from({ length: total }, (_, at) => at)}
                    columns={columns}
                    keyOf={(at) => `placeholder:${at}`}
                    render={() => <PlaceholderTile />}
                />
            )}
        </div>
    );
};
