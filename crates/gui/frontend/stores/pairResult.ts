import { create } from "zustand";
import type { Details } from "@/features/pair/details";
import type { Slot } from "@/features/start/routePairDrop";
import { cancelComparison, comparePair, type PairFailure, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { usePairViewStore } from "@/stores/pairView";
import { useScreenStore } from "@/stores/screen";

/** Where the comparison of the pair stands. */
export type Comparison =
    | { status: "comparing" }
    | { status: "done"; similarity: number }
    | { status: "failed"; error: PairFailure };

/** State of the pair result screen. */
type PairResultStore = {
    /** The pair shown, A on the left; absent until the screen is first opened. */
    files?: { a: MediaFile; b: MediaFile };
    details: Record<Slot, Details>;
    comparison: Comparison;
    /** Which files the user has marked for deletion; neither when a pair opens. */
    marked: Record<Slot, boolean>;

    /** Show the result screen for `a` and `b`, read both files' details and compare them. */
    open: (a: MediaFile, b: MediaFile) => void;
    /** Compare the pair again, keeping the details already read. */
    retry: () => void;
    /** Cancel the comparison, if it is still running, and return to the start screen. */
    leave: () => void;
    /** Mark `slot`'s file for deletion, or unmark it. */
    toggleMark: (slot: Slot) => void;
};

const LOADING: Details = { status: "loading" };
const UNMARKED: Record<Slot, boolean> = { a: false, b: false };

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

        open: (a, b) => {
            const run = ++opened;
            set({ files: { a, b }, details: { a: LOADING, b: LOADING }, marked: UNMARKED });
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
            useScreenStore.getState().show("start");
        },

        toggleMark: (slot) => set((state) => ({ marked: { ...state.marked, [slot]: !state.marked[slot] } })),
    };
});
