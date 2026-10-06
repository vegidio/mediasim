import { create } from "zustand";
import type { Details } from "@/features/pair/details";
import type { Slot } from "@/features/start/routePairDrop";
import { cancelComparison, comparePair, type PairFailure, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { type TrashOutcome, trashMedia } from "@/ipc/trash";
import { usePairStore } from "@/stores/pair";
import { usePairViewStore } from "@/stores/pairView";
import { useScreenStore } from "@/stores/screen";

/** Where the comparison of the pair stands. */
export type Comparison =
    | { status: "comparing" }
    | { status: "done"; similarity: number }
    | { status: "failed"; error: PairFailure };

/** Where the deletion of the marked files stands: not started, awaiting confirmation, or moving them. */
export type Deletion = { status: "idle" } | { status: "confirming" } | { status: "moving" };

/** The result of the last move to the Trash: the files moved, and each one that wasn't with the reason. */
export type Notice = { moved: Slot[]; failed: { slot: Slot; message: string }[] };

/** State of the pair result screen. */
type PairResultStore = {
    /** The pair shown, A on the left; absent until the screen is first opened. */
    files?: { a: MediaFile; b: MediaFile };
    details: Record<Slot, Details>;
    comparison: Comparison;
    /** Which files the user has marked for deletion; neither when a pair opens. */
    marked: Record<Slot, boolean>;
    /** Which files have been moved to the Trash; neither when a pair opens. */
    trashed: Record<Slot, boolean>;
    deletion: Deletion;
    /** The result of the last move, until it is dismissed or the screen is left. */
    notice?: Notice;

    /** Show the result screen for `a` and `b`, read both files' details and compare them. */
    open: (a: MediaFile, b: MediaFile) => void;
    /** Compare the pair again, keeping the details already read. */
    retry: () => void;
    /** Cancel the comparison, if it is still running, and return to the start screen. */
    leave: () => void;
    /** Mark `slot`'s file for deletion, or unmark it. */
    toggleMark: (slot: Slot) => void;
    /** Ask to confirm moving the marked files to the Trash; does nothing while none is marked. */
    confirmDeletion: () => void;
    /** Close the confirmation without moving anything. */
    cancelDeletion: () => void;
    /** Move the marked files to the Trash, once confirmed, and record the result. */
    moveToTrash: () => Promise<void>;
    /** Close the notice. */
    dismissNotice: () => void;
};

const LOADING: Details = { status: "loading" };
const UNMARKED: Record<Slot, boolean> = { a: false, b: false };
const IDLE: Deletion = { status: "idle" };
const SLOTS: readonly Slot[] = ["a", "b"];

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

    return {
        details: { a: LOADING, b: LOADING },
        comparison: { status: "comparing" },
        marked: UNMARKED,
        trashed: UNMARKED,
        deletion: IDLE,

        open: (a, b) => {
            const run = ++opened;
            set(
                (state) => ({
                    ...withoutNotice(state),
                    files: { a, b },
                    details: { a: LOADING, b: LOADING },
                    marked: UNMARKED,
                    trashed: UNMARKED,
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
            useScreenStore.getState().show("start");
        },

        toggleMark: (slot) => set((state) => ({ marked: { ...state.marked, [slot]: !state.marked[slot] } })),

        confirmDeletion: () => {
            const { marked, deletion } = get();
            if (deletion.status === "idle" && (marked.a || marked.b)) set({ deletion: { status: "confirming" } });
        },

        cancelDeletion: () => {
            if (get().deletion.status === "confirming") set({ deletion: IDLE });
        },

        moveToTrash: async () => {
            const { files, marked, deletion } = get();
            if (!files || deletion.status !== "confirming") return;

            const run = opened;
            const slots = SLOTS.filter((slot) => marked[slot]);
            set({ deletion: { status: "moving" } });

            // A rejection means nothing was attempted, so every file counts as not moved, with the reason.
            const outcomes = await trashMedia(slots.map((slot) => files[slot].identity)).catch(
                (error: unknown): TrashOutcome[] =>
                    slots.map(() => ({ status: "failed", reason: "trash", message: String(error) })),
            );
            if (run !== opened) return;

            const notice: Notice = { moved: [], failed: [] };
            slots.forEach((slot, index) => {
                const outcome = outcomes[index] ?? { status: "failed", message: "no result came back" };
                if (outcome.status === "trashed") notice.moved.push(slot);
                else notice.failed.push({ slot, message: outcome.message });
            });

            set((state) => {
                const trashed = { ...state.trashed };
                const marked = { ...state.marked };
                for (const slot of notice.moved) {
                    trashed[slot] = true;
                    marked[slot] = false;
                }
                return { trashed, marked, deletion: IDLE, notice };
            });

            // A trashed file can't be compared again, so it leaves the start screen's slot, unless that slot has
            // since been given another file.
            const start = usePairStore.getState();
            for (const slot of notice.moved) {
                if (start[slot]?.identity === files[slot].identity) start.remove(slot);
            }
        },

        dismissNotice: () => set(withoutNotice, true),
    };
});
