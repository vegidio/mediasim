import { create } from "zustand";

/** The pair result screen's views: both files in their own pane, or stacked under a slider. */
export type ViewMode = "side" | "slider";

/** How the pair result screen shows its files. In memory only, so it lasts the session and a restart resets it. */
type PairViewStore = {
    /** The view selected last, kept from one pair to the next. */
    mode: ViewMode;
    /** The share of the slider's stage that shows A, from 0 to 100. */
    position: number;

    setMode: (mode: ViewMode) => void;
    /** Move the slider's handle, clamped to 0–100. */
    setPosition: (position: number) => void;
    /** Put the slider's handle back in the middle, for a new pair. */
    resetPosition: () => void;
};

const MIDDLE = 50;

export const usePairViewStore = create<PairViewStore>()((set) => ({
    mode: "side",
    position: MIDDLE,
    setMode: (mode) => set({ mode }),
    setPosition: (position) => set({ position: Math.min(100, Math.max(0, position)) }),
    resetPosition: () => set({ position: MIDDLE }),
}));
