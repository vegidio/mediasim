import { create } from "zustand";
import { listSetMedia } from "@/ipc/set";
import type { MediaFile } from "@/ipc/thumbs";
import { useSettingsStore } from "@/stores/settings";
import { useStartStore } from "@/stores/start";

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
     * Starts a new comparison: the threshold goes back to the "Default match threshold" setting, no file is removed, and
     * every folder is recounted, so files added or deleted on disk since it was counted show up or drop out.
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
    /** The path of the file whose tile takes focus once the grid shows it, as after the dialog closes. */
    focusTile?: string;
    /** Open the media details dialog on the file at `path`. */
    openDetails: (path: string) => void;
    /** Show the file at `path` in the open media details dialog. */
    showDetails: (path: string) => void;
    /** Close the media details dialog, handing focus to the tile of the file it last showed. */
    closeDetails: () => void;
    /** Forget {@link focusTile}, once the tile has taken focus. */
    tileFocused: () => void;
    /**
     * The paths of the files removed from this comparison. They keep their place in the gallery, but Compare leaves
     * them out. Kept across re-reads of the set's files, for as long as the files are still in it.
     */
    removed: ReadonlySet<string>;
    /** Remove the file at `path` from the comparison. */
    remove: (path: string) => void;
    /** Undo {@link remove} for the file at `path`. */
    addBack: (path: string) => void;
};

type StartState = ReturnType<typeof useStartStore.getState>;

/** Whether the set is fully counted: no rescan running and no row still being counted. */
const isSettled = ({ rescans, sources }: StartState) => rescans === 0 && !sources.some((row) => row.pending);

/** Resolves once the set is fully counted, at once when it already is. */
const settled = () =>
    new Promise<void>((resolve) => {
        if (isSettled(useStartStore.getState())) return resolve();

        const unsubscribe = useStartStore.subscribe((state) => {
            if (!isSettled(state)) return;
            unsubscribe();
            resolve();
        });
    });

let requests = 0;

/** `state` without the details dialog's file. */
const withoutDetails = ({ details: _closed, ...rest }: GalleryStore): GalleryStore => rest;

/**
 * `state` with `listing`, closing the details dialog when its file is no longer in it, and forgetting the removal of
 * any file no longer in it.
 */
const withListing = (state: GalleryStore, listing: GalleryListing): GalleryStore => {
    if (listing.status !== "ready") return { ...state, listing };

    const paths = new Set(listing.files.map((file) => file.path));
    const { details, removed } = state;
    const gone = details !== undefined && !paths.has(details);
    const kept = [...removed].filter((path) => paths.has(path));

    return {
        ...(gone ? withoutDetails(state) : state),
        listing,
        ...(kept.length !== removed.size && { removed: new Set(kept) }),
    };
};

export const useGalleryStore = create<GalleryStore>()((set, get) => ({
    filter: "both",
    setFilter: (filter) => set({ filter }),
    // The settings store rehydrates synchronously at import, so this already reads what the user chose.
    threshold: useSettingsStore.getState().matchThreshold,
    setThreshold: (threshold) => set({ threshold }),
    begin: () => {
        set({ threshold: useSettingsStore.getState().matchThreshold, removed: new Set() });
        // The recount bumps the set's revision, so the next load reads the files again instead of keeping the last read.
        void useStartStore.getState().refresh();
    },
    listing: { status: "idle" },

    load: async () => {
        const request = ++requests;

        if (!isSettled(useStartStore.getState())) {
            set({ listing: { status: "loading" } });
            await settled();
            if (request !== requests) return;
        }

        const { listing } = get();
        // Rust's revision can run ahead of the view the start screen applied, never behind it.
        if (listing.status === "ready" && listing.revision >= useStartStore.getState().view.revision) return;

        set({ listing: { status: "loading" } });
        try {
            const { revision, files } = await listSetMedia();
            if (request === requests) set((state) => withListing(state, { status: "ready", revision, files }), true);
        } catch (error) {
            console.error("could not list the set's files", error);
            if (request === requests) set({ listing: { status: "failed" } });
        }
    },

    openDetails: (path) => set(({ focusTile: _stale, ...rest }) => ({ ...rest, details: path }), true),
    showDetails: (path) => set({ details: path }),
    closeDetails: () =>
        set((state) => {
            const { details } = state;
            return details === undefined ? state : { ...withoutDetails(state), focusTile: details };
        }, true),
    tileFocused: () => set(({ focusTile: _done, ...rest }) => rest, true),
    removed: new Set(),
    remove: (path) => set(({ removed }) => ({ removed: new Set(removed).add(path) })),
    addBack: (path) =>
        set(({ removed }) => {
            const next = new Set(removed);
            next.delete(path);
            return { removed: next };
        }),
}));

// Follow the "Default match threshold" setting, whether the user changed it or reset it.
useSettingsStore.subscribe((settings, previous) => {
    if (settings.matchThreshold !== previous.matchThreshold) {
        useGalleryStore.getState().setThreshold(settings.matchThreshold);
    }
});
