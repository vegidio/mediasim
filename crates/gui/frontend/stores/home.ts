import { create } from "zustand";
import { addToSet, clearSet, removeFromSet, rescanSet, type SetView, type SourceView } from "@/ipc/set";
import { fileName } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings";

/** A row added a moment ago, shown until Rust describes it; its kind is not known yet. */
export type PendingRow = { path: string; name: string; pending: true; kind?: undefined };

/** A row of the set list: a source as Rust describes it, or one still on its way there. */
export type SourceRow = SourceView | PendingRow;

/** A pending row together with the request that added it, which clears it when it settles. */
type Optimistic = PendingRow & { request: number };

/** State of the Home screen, kept for as long as the application runs. */
type HomeStore = {
    /**
     * Whether folders added to a set are scanned recursively. It starts from the "Scan subfolders" setting and follows
     * it when it changes, but toggling it here lasts only for the session and never writes the setting.
     */
    scanSubfolders: boolean;
    /** The set list's rows, in the order they were added. */
    sources: SourceRow[];

    /** Add files and folders to the set. */
    add: (paths: string[]) => Promise<void>;
    /** Remove the source added as `path`. */
    remove: (path: string) => Promise<void>;
    /** Remove every source, including any still being added or counted. "Scan subfolders" is left as it is. */
    clear: () => Promise<void>;
    /** Set "Scan subfolders" and recount every folder to match; nothing happens when it already has that value. */
    setScanSubfolders: (value: boolean) => Promise<void>;
    /** Flip "Scan subfolders" and recount every folder to match. */
    toggleScanSubfolders: () => Promise<void>;
    /** Recount every folder as it is on disk now, keeping "Scan subfolders" as it is. */
    refresh: () => Promise<void>;

    /** The last view applied from Rust. */
    view: SetView;
    /** Rows added but not yet described by any applied view. */
    optimistic: Optimistic[];
    /** Rescans still running; while any is, every folder is being recounted. */
    rescans: number;
};

/**
 * Rust's rows, then the optimistic rows it does not describe yet. While a rescan runs, every folder shows as being
 * counted, since a view taken before the rescan started still carries the old counts.
 */
const merge = (view: SetView, optimistic: Optimistic[], rescanning: boolean): SourceRow[] => {
    const sources = rescanning
        ? view.sources.map((source) => (source.kind === "folder" ? { ...source, pending: true } : source))
        : view.sources;
    // Each path once: Rust's row when it has one, else the first optimistic row for it.
    const seen = new Set(view.sources.map((source) => source.path));
    const pending: PendingRow[] = [];
    for (const { path, name } of optimistic) {
        if (seen.has(path)) continue;
        seen.add(path);
        pending.push({ path, name, pending: true });
    }

    return [...sources, ...pending];
};

type RowInputs = Pick<HomeStore, "view" | "optimistic" | "rescans">;

/** `changes`, together with the rows they give once applied to `state`. */
const withRows = (state: RowInputs, changes: Partial<RowInputs>) => {
    const { view, optimistic, rescans } = { ...state, ...changes };
    return { ...changes, sources: merge(view, optimistic, rescans > 0) };
};

const EMPTY: SetView = { revision: 0, sources: [], total: 0 };

let requests = 0;

export const useHomeStore = create<HomeStore>()((set, get) => {
    /**
     * Apply a view from Rust, unless one describing a later state of the set is already shown. Responses arrive out of
     * order, since each waits for its own listing, so the set's revision orders them, not the order they were asked in.
     */
    const apply = (view: SetView) =>
        set((state) => {
            if (view.revision <= state.view.revision) return {};
            return withRows(state, { view });
        });

    /** Drop the pending rows `request` added, now that it has settled either way. */
    const settle = (request: number) =>
        set((state) => withRows(state, { optimistic: state.optimistic.filter((row) => row.request !== request) }));

    /** Count a rescan as started or finished, and show the folders as being recounted for as long as one runs. */
    const rescanning = (delta: 1 | -1) => set((state) => withRows(state, { rescans: state.rescans + delta }));

    const report = (action: string) => (error: unknown) => console.error(`could not ${action}`, error);

    /** Recount every folder with `recursive`, showing them as being counted until it answers. */
    const rescan = async (recursive: boolean) => {
        rescanning(1);

        try {
            await rescanSet(recursive).then(apply, report("rescan the set"));
        } finally {
            rescanning(-1);
        }
    };

    return {
        // The settings store rehydrates synchronously at import, so this already reads what the user chose.
        scanSubfolders: useSettingsStore.getState().scanSubfolders,
        sources: [],
        view: EMPTY,
        optimistic: [],
        rescans: 0,

        add: async (paths) => {
            const request = ++requests;
            set((state) =>
                withRows(state, {
                    optimistic: [
                        ...state.optimistic,
                        ...paths.map((path): Optimistic => ({ path, name: fileName(path), pending: true, request })),
                    ],
                }),
            );

            try {
                apply(await addToSet(paths, get().scanSubfolders));
            } catch (error) {
                report("add to the set")(error);
            } finally {
                settle(request);
            }
        },

        remove: async (path) => {
            set((state) => withRows(state, { optimistic: state.optimistic.filter((row) => row.path !== path) }));

            await removeFromSet(path).then(apply, report("remove from the set"));
        },

        clear: async () => {
            // Empty the list at once. The revision stays, so Rust's answer still applies, and replaces any view that
            // arrives before it from an add Rust has since cleared.
            set((state) => withRows(state, { view: { ...state.view, sources: [], total: 0 }, optimistic: [] }));

            await clearSet().then(apply, report("clear the set"));
        },

        setScanSubfolders: async (scanSubfolders) => {
            if (scanSubfolders === get().scanSubfolders) return;
            set({ scanSubfolders });
            await rescan(scanSubfolders);
        },

        toggleScanSubfolders: () => get().setScanSubfolders(!get().scanSubfolders),

        refresh: () => rescan(get().scanSubfolders),
    };
});

// Follow the "Scan subfolders" setting, whether the user changed it, reset it, or it was rehydrated.
useSettingsStore.subscribe((settings, previous) => {
    if (settings.scanSubfolders !== previous.scanSubfolders) {
        void useHomeStore.getState().setScanSubfolders(settings.scanSubfolders);
    }
});
