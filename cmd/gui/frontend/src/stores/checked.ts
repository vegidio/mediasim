import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type CheckedStore = {
    checkedPaths: Set<string>;
    toggle: (path: string) => void;
    clear: () => void;
};

export const useCheckedStore = create<CheckedStore>()(
    immer((set) => ({
        checkedPaths: new Set<string>(),

        toggle: (path) =>
            set((state) => {
                if (state.checkedPaths.has(path)) {
                    state.checkedPaths.delete(path);
                } else {
                    state.checkedPaths.add(path);
                }
            }),

        clear: () =>
            set((state) => {
                state.checkedPaths.clear();
            }),
    })),
);
