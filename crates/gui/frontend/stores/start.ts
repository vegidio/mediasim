import { create } from "zustand";

/** State of the start screen, kept for as long as the application runs. */
type StartStore = {
    /** Whether folders added to a set are scanned recursively. */
    scanSubfolders: boolean;

    toggleScanSubfolders: () => void;
};

export const useStartStore = create<StartStore>()((set) => ({
    scanSubfolders: true,

    toggleScanSubfolders: () => set((state) => ({ scanSubfolders: !state.scanSubfolders })),
}));
