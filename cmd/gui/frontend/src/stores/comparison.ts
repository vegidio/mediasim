import type { ComparisonGroup } from '@bindings/gui/services/models.js';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ComparisonStore = {
    /**
     * This field can be undefined, instead of simply an empty array [], to indicate that no comparison ran yet.
     *
     * An empty array [], on the other hand, means that the comparison ran but no matches were found.
     */
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
