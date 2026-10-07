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
    /** Starts a new comparison: the threshold goes back to the "Default match threshold" setting. */
    begin: () => void;
    listing: GalleryListing;
    /**
     * Read the set's files, once any recount has finished, unless they were already read at the set's current
     * revision.
     */
    load: () => Promise<void>;
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

export const useGalleryStore = create<GalleryStore>()((set, get) => ({
    filter: "both",
    setFilter: (filter) => set({ filter }),
    // The settings store rehydrates synchronously at import, so this already reads what the user chose.
    threshold: useSettingsStore.getState().matchThreshold,
    setThreshold: (threshold) => set({ threshold }),
    begin: () => set({ threshold: useSettingsStore.getState().matchThreshold }),
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
            if (request === requests) set({ listing: { status: "ready", revision, files } });
        } catch (error) {
            console.error("could not list the set's files", error);
            if (request === requests) set({ listing: { status: "failed" } });
        }
    },
}));

// Follow the "Default match threshold" setting, whether the user changed it or reset it.
useSettingsStore.subscribe((settings, previous) => {
    if (settings.matchThreshold !== previous.matchThreshold) {
        useGalleryStore.getState().setThreshold(settings.matchThreshold);
    }
});
