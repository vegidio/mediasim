import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** How the marked files are removed: moved to the platform's Trash, or deleted from disk. */
export type DeletionMode = "trash" | "permanent";

/** Every deletion mode, in the order the Settings screen offers them. */
export const DELETION_MODES = ["trash", "permanent"] as const satisfies readonly DeletionMode[];

const isDeletionMode = (value: unknown): value is DeletionMode =>
    (DELETION_MODES as readonly unknown[]).includes(value);

/** What the Settings screen holds: the preferences themselves, with no actions among them. */
export type SettingsData = {
    deletionMode: DeletionMode;
    /** Whether the deletion confirmation is shown before anything is removed. */
    confirmDeletion: boolean;
};

type SettingsStore = SettingsData & {
    /** Puts a control's change in force at once, and on disk: the Settings screen has no Save. */
    update: (values: Partial<SettingsData>) => void;
    /** Puts every preference back to {@link SETTINGS_DEFAULTS}. */
    reset: () => void;
};

/** What every preference reads as for a user who has never chosen, and after Reset to defaults. */
export const SETTINGS_DEFAULTS: SettingsData = { deletionMode: "trash", confirmDeletion: true };

/**
 * The preferences on the Settings screen, remembered across restarts in the webview's `localStorage`.
 *
 * They rehydrate synchronously at import, so the first render already reads what the user chose. A stored value this
 * version doesn't recognise falls back to its own default without touching the others, and storage that can't be read
 * at all leaves every preference at its default.
 */
export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            ...SETTINGS_DEFAULTS,
            update: (values) => set(values),
            reset: () => set(SETTINGS_DEFAULTS),
        }),
        {
            name: "settings-storage",
            storage: createJSONStorage(() => localStorage),
            // No earlier shape exists; the number is there for a later one to migrate from.
            version: 1,
            // Data only: the actions are rebuilt on every launch.
            partialize: ({ deletionMode, confirmDeletion }): SettingsData => ({ deletionMode, confirmDeletion }),
            merge: (persisted, current): SettingsStore => {
                // `persist` calls this whether or not anything was stored.
                if (typeof persisted !== "object" || persisted === null) return current;

                const stored = persisted as Partial<Record<keyof SettingsData, unknown>>;

                return {
                    ...current,
                    deletionMode: isDeletionMode(stored.deletionMode)
                        ? stored.deletionMode
                        : SETTINGS_DEFAULTS.deletionMode,
                    confirmDeletion:
                        typeof stored.confirmDeletion === "boolean"
                            ? stored.confirmDeletion
                            : SETTINGS_DEFAULTS.confirmDeletion,
                };
            },
        },
    ),
);
