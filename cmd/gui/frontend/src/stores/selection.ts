import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type SelectionStore = {
    selectedPath?: string;
    select: (path: string) => void;
    clear: () => void;
};

export const useSelectionStore = create<SelectionStore>()(
    immer((set) => ({
        selectedPath: undefined,

        select: (path) =>
            set((state) => {
                state.selectedPath = path;
            }),

        clear: () =>
            set((state) => {
                state.selectedPath = undefined;
            }),
    })),
);
