import type { ComparisonGroup } from '@bindings/gui/services/models';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type CheckedStore = {
    checkedPaths: Set<string>;
    toggle: (path: string) => void;
    autoMark: (groups: ComparisonGroup[]) => void;
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

        autoMark: (groups) =>
            set((state) => {
                for (const group of groups) {
                    const [first, ...rest] = group.media;
                    state.checkedPaths.delete(first.path);
                    for (const media of rest) {
                        state.checkedPaths.add(media.path);
                    }
                }
            }),

        clear: () =>
            set((state) => {
                state.checkedPaths.clear();
            }),
    })),
);
