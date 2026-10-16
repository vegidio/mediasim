import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** How the groups screen lays out its groups: side by side as cards, or stacked full-width as a list. */
export type GroupsLayout = "cards" | "list";

const isGroupsLayout = (value: unknown): value is GroupsLayout => value === "cards" || value === "list";

type GroupsViewStore = {
    /** The layout selected last. */
    layout: GroupsLayout;

    setLayout: (layout: GroupsLayout) => void;
};

/**
 * How the groups screen shows its groups, remembered across restarts in the webview's `localStorage`. Apart from the
 * settings, so Reset to defaults leaves it alone. A stored value this version doesn't recognise falls back to cards.
 */
export const useGroupsViewStore = create<GroupsViewStore>()(
    persist(
        (set) => ({
            layout: "cards",
            setLayout: (layout) => set({ layout }),
        }),
        {
            name: "groups-view-storage",
            storage: createJSONStorage(() => localStorage),
            version: 1,
            partialize: ({ layout }) => ({ layout }),
            merge: (persisted, current): GroupsViewStore => {
                if (typeof persisted !== "object" || persisted === null) return current;

                const { layout } = persisted as { layout?: unknown };
                return { ...current, layout: isGroupsLayout(layout) ? layout : "cards" };
            },
        },
    ),
);
