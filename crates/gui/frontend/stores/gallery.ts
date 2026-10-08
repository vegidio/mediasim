import { create } from "zustand";
import { listSetMedia } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useHomeStore } from "@/stores/home";
import { useSettingsStore } from "@/stores/settings";

/** Which files a comparison includes: the images, the videos, or both. */
export type GalleryFilter = "images" | "videos" | "both";

/** The set's files as the gallery last read them. */
export type GalleryListing =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; revision: number; files: MediaFile[] }
    | { status: "failed" };

/** State of the gallery, kept for as long as the application runs. */
type GalleryStore = {
    filter: GalleryFilter;
    setFilter: (filter: GalleryFilter) => void;
    /**
     * The match threshold, in whole percent. Each new comparison starts it from the "Default match threshold" setting,
     * and it follows the setting when that changes, but moving it here never writes the setting.
     */
    threshold: number;
    setThreshold: (threshold: number) => void;
    /**
     * Starts a new comparison: the threshold goes back to the "Default match threshold" setting, no file is overridden,
     * and every folder is recounted, so files added or deleted on disk since it was counted show up or drop out.
     */
    begin: () => void;
    listing: GalleryListing;
    /**
     * Read the set's files, once any recount has finished, unless they were already read at the set's current
     * revision.
     */
    load: () => Promise<void>;
    /** The path of the file the media details dialog shows, while it is open. */
    details?: string;
    /** The path of the selected tile's file, if a tile is selected. */
    selected?: string;
    /** Select the tile of the file at `path`. */
    select: (path: string) => void;
    /** Leave no tile selected. */
    clearSelection: () => void;
    /**
     * A request for the grid to take keyboard focus, scrolling the selected tile into view when `reveal` says so, as
     * after the dialog closes.
     */
    focusGrid?: { reveal: boolean };
    /** Hand keyboard focus back to the grid, where it stands, as after a click on a filter tab. */
    returnToGrid: () => void;
    /** Open the media details dialog on the file at `path`. */
    openDetails: (path: string) => void;
    /** Show the file at `path` in the open media details dialog. */
    showDetails: (path: string) => void;
    /** Close the media details dialog, selecting the tile of the file it last showed and asking the grid for focus. */
    closeDetails: () => void;
    /** Forget {@link focusGrid}, once the grid has taken focus. */
    gridFocused: () => void;
    /**
     * The paths of the files whose inclusion the user flipped against the selected tab: removed when the tab includes
     * them, added when it leaves them out. Cleared when the tab changes, and kept across re-reads of the set's files
     * for as long as the files are still in it.
     */
    overrides: ReadonlySet<string>;
    /** Flip whether the file at `path` is in the comparison, against what the selected tab says. */
    toggle: (path: string) => void;
};

type HomeState = ReturnType<typeof useHomeStore.getState>;

/** Whether the set is fully counted: no rescan running and no row still being counted. */
const isSettled = ({ rescans, sources }: HomeState) => rescans === 0 && !sources.some((row) => row.pending);

/** Resolves once the set is fully counted, at once when it already is. */
const settled = () =>
    new Promise<void>((resolve) => {
        if (isSettled(useHomeStore.getState())) return resolve();

        const unsubscribe = useHomeStore.subscribe((state) => {
            if (!isSettled(state)) return;
            unsubscribe();
            resolve();
        });
    });

let requests = 0;

/** `state` without the details dialog's file. */
const withoutDetails = ({ details: _closed, ...rest }: GalleryStore): GalleryStore => rest;

/** `state` with no tile selected. */
const withoutSelection = ({ selected: _cleared, ...rest }: GalleryStore): GalleryStore => rest;

/**
 * `state` with `listing`, closing the details dialog and clearing the selection when their file is no longer in it, and
 * forgetting the override of any file no longer in it.
 */
const withListing = (state: GalleryStore, listing: GalleryListing): GalleryStore => {
    if (listing.status !== "ready") return { ...state, listing };

    const paths = new Set(listing.files.map((file) => file.path));
    const { details, selected, overrides } = state;
    const gone = (path?: string) => !!path && !paths.has(path);
    const kept = [...overrides].filter((path) => paths.has(path));
    let next = gone(details) ? withoutDetails(state) : state;
    if (gone(selected)) next = withoutSelection(next);

    return {
        ...next,
        listing,
        ...(kept.length !== overrides.size && { overrides: new Set(kept) }),
    };
};

export const useGalleryStore = create<GalleryStore>()((set, get) => ({
    filter: "both",
    // A new tab starts over from its own default, so the files flipped against the old one are forgotten.
    setFilter: (filter) => set((state) => (filter === state.filter ? state : { filter, overrides: new Set() })),
    // The settings store rehydrates synchronously at import, so this already reads what the user chose.
    threshold: useSettingsStore.getState().matchThreshold,
    setThreshold: (threshold) => set({ threshold }),
    begin: () => {
        set(
            (state) => ({
                ...withoutSelection(state),
                threshold: useSettingsStore.getState().matchThreshold,
                overrides: new Set(),
            }),
            true,
        );
        // The recount bumps the set's revision, so the next load reads the files again instead of keeping the last read.
        void useHomeStore.getState().refresh();
    },
    listing: { status: "idle" },

    load: async () => {
        const request = ++requests;

        if (!isSettled(useHomeStore.getState())) {
            set({ listing: { status: "loading" } });
            await settled();
            if (request !== requests) return;
        }

        const { listing } = get();
        // Rust's revision can run ahead of the view the Home screen applied, never behind it.
        if (listing.status === "ready" && listing.revision >= useHomeStore.getState().view.revision) return;

        set({ listing: { status: "loading" } });
        try {
            const { revision, files } = await listSetMedia();
            if (request === requests) set((state) => withListing(state, { status: "ready", revision, files }), true);
        } catch (error) {
            console.error("could not list the set's files", error);
            if (request === requests) set({ listing: { status: "failed" } });
        }
    },

    select: (path) => set({ selected: path }),
    clearSelection: () => set(withoutSelection, true),
    returnToGrid: () => set({ focusGrid: { reveal: false } }),
    openDetails: (path) => set(({ focusGrid: _stale, ...rest }) => ({ ...rest, details: path }), true),
    showDetails: (path) => set({ details: path }),
    closeDetails: () =>
        set((state) => {
            const { details } = state;
            return !details ? state : { ...withoutDetails(state), selected: details, focusGrid: { reveal: true } };
        }, true),
    gridFocused: () => set(({ focusGrid: _done, ...rest }) => rest, true),
    overrides: new Set(),
    toggle: (path) =>
        set(({ overrides }) => {
            const next = new Set(overrides);
            if (!next.delete(path)) next.add(path);
            return { overrides: next };
        }),
}));

// Follow the "Default match threshold" setting, whether the user changed it or reset it.
useSettingsStore.subscribe((settings, previous) => {
    if (settings.matchThreshold !== previous.matchThreshold) {
        useGalleryStore.getState().setThreshold(settings.matchThreshold);
    }
});
