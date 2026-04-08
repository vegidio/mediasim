import type { ComparisonGroup } from '@bindings/gui/services/models.js';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useSelectionStore } from './selection';

type ComparisonStore = {
    /**
     * This field can be undefined, instead of simply an empty array [], to indicate that no comparison ran yet.
     *
     * An empty array [], on the other hand, means that the comparison ran but no matches were found.
     */
    groups?: ComparisonGroup[];

    setGroups: (groups: ComparisonGroup[]) => void;
    removeFiles: (paths: Set<string>) => void;
    clear: () => void;
};

export const useComparisonStore = create<ComparisonStore>()(
    immer((set) => ({
        groups: undefined,

        setGroups: (groups: ComparisonGroup[]) => {
            set((state) => {
                state.groups = [...groups].sort((a, b) =>
                    (a.media[0]?.path ?? '').localeCompare(b.media[0]?.path ?? ''),
                );
            });
            useSelectionStore.getState().clear();
        },

        removeFiles: (paths: Set<string>) => {
            set((state) => {
                if (!state.groups) return;

                state.groups = state.groups
                    .map((group) => ({
                        ...group,
                        media: group.media.filter((m) => !paths.has(m.path)),
                    }))
                    .filter((group) => group.media.length > 1);
            });
        },

        clear: () => {
            set((state) => {
                state.groups = undefined;
            });
            useSelectionStore.getState().clear();
        },
    })),
);
