import type { ComparisonGroup } from '@bindings/gui/services/models.js';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ComparisonStore = {
    groups?: ComparisonGroup[];
    setGroups: (groups: ComparisonGroup[]) => void;
    clear: () => void;
};

export const useComparisonStore = create<ComparisonStore>()(
    immer((set) => ({
        groups: undefined,

        setGroups: (groups: ComparisonGroup[]) => {
            set((state) => {
                state.groups = groups;
            });
        },

        clear: () => {
            set((state) => {
                state.groups = undefined;
            });
        },
    })),
);
