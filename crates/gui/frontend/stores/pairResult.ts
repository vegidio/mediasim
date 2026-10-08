import { create } from "zustand";
import { SLOTS, type Slot } from "@/features/home/routePairDrop";
import type { Details } from "@/features/pair/details";
import { cancelComparison, comparePair, type PairFailure, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import {
    type DeleteOutcome,
    deleteMedia,
    type RestoreOutcome,
    restoreMedia,
    type TrashOutcome,
    trashMedia,
} from "@/ipc/trash";
import { usePairStore } from "@/stores/pair";
import { usePairViewStore } from "@/stores/pairView";
import { useScreenStore } from "@/stores/screen";
import { type DeletionMode, useSettingsStore } from "@/stores/settings";

/** Where the comparison of the pair stands. */
export type Comparison =
    | { status: "comparing" }
    | { status: "done"; similarity: number }
    | { status: "failed"; error: PairFailure };

/**
 * How a file left, as the deletion mode it was removed in: moved to the Trash, which Undo can reverse, or deleted from
 * disk, which nothing can.
 */
export type GoneKind = DeletionMode;

/**
 * Where the deletion of the marked files stands: not started, awaiting confirmation, removing them, or restoring files
 * moved. The mode is the one in force when the deletion was asked for, and `confirmed` says whether the confirmation
 * was shown. A removal and a restore never run at once.
 */
export type Deletion =
    | { status: "idle" }
    | { status: "confirming"; mode: DeletionMode }
    | { status: "removing"; mode: DeletionMode; confirmed: boolean }
    | { status: "restoring" };

/**
 * The result of the last move to the Trash, permanent deletion or restore: the files it was done to, and each one it
 * wasn't with the reason.
 */
export type Notice = {
    action: DeletionMode | "restore";
    done: Slot[];
    failed: { slot: Slot; message: string }[];
};

/** State of the pair result screen. */
type PairResultStore = {
    /** The pair shown, A on the left; absent until the screen is first opened. */
    files?: { a: MediaFile; b: MediaFile };
    details: Record<Slot, Details>;
    comparison: Comparison;
    /** Which files the user has marked for deletion; neither when a pair opens. */
    marked: Record<Slot, boolean>;
    /** How each file that has left went; neither when a pair opens. */
    gone: Partial<Record<Slot, GoneKind>>;
    deletion: Deletion;
    /** The result of the last move or restore, until it is dismissed or the screen is left. */
    notice?: Notice;

    /** Show the result screen for `a` and `b`, read both files' details and compare them. */
    open: (a: MediaFile, b: MediaFile) => void;
    /** Compare the pair again, keeping the details already read. */
    retry: () => void;
    /** Cancel the comparison, if it is still running, and return to the Home screen. */
    leave: () => void;
    /** Mark `slot`'s file for deletion, or unmark it. */
    toggleMark: (slot: Slot) => void;
    /**
     * Start removing the marked files in the deletion mode in force: ask to confirm first while the settings say so,
     * or remove them at once. Does nothing while none is marked or another deletion or restore is under way.
     */
    requestDeletion: () => Promise<void>;
    /** Close the confirmation without removing anything. */
    cancelDeletion: () => void;
    /** Remove the marked files in the confirming mode, once confirmed, and record the result. */
    removeMarked: () => Promise<void>;
    /** Put the files of `slots` that are in the Trash back where they were, and record the result. */
    restore: (slots: Slot[]) => Promise<void>;
    /** Close the notice. */
    dismissNotice: () => void;
};

const LOADING: Details = { status: "loading" };
const UNMARKED: Record<Slot, boolean> = { a: false, b: false };
/** No file gone, as a pair opens. */
export const NONE_GONE: Partial<Record<Slot, GoneKind>> = {};
const IDLE: Deletion = { status: "idle" };

/** The files marked for deletion, A first; none before a pair is open. */
export const selectMarkedFiles = ({ files, marked }: PairResultStore): MediaFile[] =>
    files ? SLOTS.filter((slot) => marked[slot]).map((slot) => files[slot]) : [];

/** `state` without a notice, for a replacing `set`. */
const withoutNotice = ({ notice: _dropped, ...rest }: PairResultStore): PairResultStore => rest;

export const usePairResultStore = create<PairResultStore>()((set, get) => {
    /**
     * Run guards: `opened` numbers the pairs opened, which the probes check, and `compared` the comparisons started,
     * which a comparison checks. A result is applied only while its number is still current, so nothing from a pair
     * left or replaced, or from a comparison retried, ever reaches the screen. `retry` moves only `compared`, so it
     * keeps the probes still reading.
     */
    let opened = 0;
    let compared = 0;

    const probe = (slot: Slot, file: MediaFile, run: number) => {
        const apply = (details: Details) => {
            if (run === opened) set((state) => ({ details: { ...state.details, [slot]: details } }));
        };

        probeMedia(file.path).then(
            (info) => apply({ status: "ready", info }),
            () => apply({ status: "failed" }),
        );
    };

    const compare = ({ a, b }: { a: MediaFile; b: MediaFile }) => {
        const run = ++compared;
        set({ comparison: { status: "comparing" } });

        comparePair(a.path, b.path).then(
            (similarity) => {
                if (run === compared) set({ comparison: { status: "done", similarity } });
            },
            // A `cancelled` failure only ever comes from a run already replaced or left, which this guard drops.
            (error: PairFailure) => {
                if (run === compared) set({ comparison: { status: "failed", error } });
            },
        );
    };

    /** Removes the marked files in `mode`, and records how each went. */
    const remove = async (mode: DeletionMode, confirmed: boolean) => {
        const { files, marked } = get();
        if (!files) return;

        const run = opened;
        const slots = SLOTS.filter((slot) => marked[slot]);
        set({ deletion: { status: "removing", mode, confirmed } });

        const identities = slots.map((slot) => files[slot].identity);
        // A rejection means nothing was attempted, so every file counts as not removed, with the reason.
        const outcomes =
            mode === "trash"
                ? await trashMedia(identities).catch((error: unknown): TrashOutcome[] =>
                      slots.map(() => ({ status: "failed", reason: "trash", message: String(error) })),
                  )
                : await deleteMedia(identities).catch((error: unknown): DeleteOutcome[] =>
                      slots.map(() => ({ status: "failed", reason: "delete", message: String(error) })),
                  );
        if (run !== opened) return;

        const notice: Notice = { action: mode, done: [], failed: [] };
        slots.forEach((slot, index) => {
            const outcome = outcomes[index] ?? { status: "failed", message: "no result came back" };
            if (outcome.status === "failed") notice.failed.push({ slot, message: outcome.message });
            else notice.done.push(slot);
        });

        set((state) => {
            const gone = { ...state.gone };
            const marked = { ...state.marked };
            for (const slot of notice.done) {
                gone[slot] = mode;
                marked[slot] = false;
            }
            return { gone, marked, deletion: IDLE, notice };
        });

        // A file gone can't be compared again, so it leaves the Home screen's slot, unless that slot has since been
        // given another file.
        const start = usePairStore.getState();
        for (const slot of notice.done) {
            if (start[slot]?.identity === files[slot].identity) start.remove(slot);
        }
    };

    return {
        details: { a: LOADING, b: LOADING },
        comparison: { status: "comparing" },
        marked: UNMARKED,
        gone: NONE_GONE,
        deletion: IDLE,

        open: (a, b) => {
            const run = ++opened;
            set(
                (state) => ({
                    ...withoutNotice(state),
                    files: { a, b },
                    details: { a: LOADING, b: LOADING },
                    marked: UNMARKED,
                    gone: NONE_GONE,
                    deletion: IDLE,
                }),
                true,
            );
            // Each pair's slider starts in the middle; the view mode carries over.
            usePairViewStore.getState().resetPosition();
            useScreenStore.getState().show("pair");

            probe("a", a, run);
            probe("b", b, run);
            compare({ a, b });
        },

        retry: () => {
            const { files } = get();
            if (files) compare(files);
        },

        leave: () => {
            opened += 1;
            compared += 1;
            cancelComparison().catch((error: unknown) => console.error("could not cancel the comparison", error));
            set(withoutNotice, true);
            useScreenStore.getState().show("home");
        },

        toggleMark: (slot) => set((state) => ({ marked: { ...state.marked, [slot]: !state.marked[slot] } })),

        requestDeletion: async () => {
            const { marked, deletion } = get();
            if (deletion.status !== "idle" || !(marked.a || marked.b)) return;

            // Read once, so this deletion keeps its mode whatever Settings says by the time it is confirmed.
            const { deletionMode, confirmDeletion } = useSettingsStore.getState();
            if (confirmDeletion) set({ deletion: { status: "confirming", mode: deletionMode } });
            else await remove(deletionMode, false);
        },

        cancelDeletion: () => {
            if (get().deletion.status === "confirming") set({ deletion: IDLE });
        },

        removeMarked: async () => {
            const { deletion } = get();
            if (deletion.status === "confirming") await remove(deletion.mode, true);
        },

        restore: async (requested) => {
            const { files, gone, deletion } = get();
            if (!files || deletion.status !== "idle") return;

            const run = opened;
            // A deleted file is never sent: only the Trash can give a file back.
            const slots = SLOTS.filter((slot) => requested.includes(slot) && gone[slot] === "trash");
            if (slots.length === 0) return;
            set({ deletion: { status: "restoring" } });

            // A rejection means nothing was attempted, so every file counts as not restored, with the reason.
            const outcomes = await restoreMedia(slots.map((slot) => files[slot].identity)).catch(
                (error: unknown): RestoreOutcome[] =>
                    slots.map(() => ({ status: "failed", reason: "restore", message: String(error) })),
            );
            if (run !== opened) return;

            const notice: Notice = { action: "restore", done: [], failed: [] };
            // A restored file can come back under a new identity, which `thumb://` and a later move need.
            const restored: Partial<Record<Slot, MediaFile>> = {};
            slots.forEach((slot, index) => {
                const outcome = outcomes[index] ?? { status: "failed", message: "no result came back" };
                if (outcome.status === "restored") {
                    notice.done.push(slot);
                    restored[slot] = { ...files[slot], identity: outcome.identity };
                } else {
                    notice.failed.push({ slot, message: outcome.message });
                }
            });

            set((state) => {
                if (!state.files) return { deletion: IDLE, notice };
                const gone = { ...state.gone };
                for (const slot of notice.done) delete gone[slot];
                return { files: { ...state.files, ...restored }, gone, deletion: IDLE, notice };
            });

            // Back in its start slot, unless that slot has been given another file since.
            const start = usePairStore.getState();
            for (const slot of notice.done) {
                const file = restored[slot];
                if (file) start.refill(slot, file);
            }
        },

        dismissNotice: () => set(withoutNotice, true),
    };
});
