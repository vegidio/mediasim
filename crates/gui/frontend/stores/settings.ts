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
    /** The similarity, in whole percent from 50 to 100, at or above which files are grouped by default. */
    matchThreshold: number;
    /** Whether folders added to a set are scanned recursively, as the set card starts. */
    scanSubfolders: boolean;
    /** Whether each frame is also compared rotated 90°, 180° and 270°. */
    frameRotate: boolean;
    /** Whether each frame is also compared flipped vertically and horizontally. */
    frameFlip: boolean;
};

type SettingsStore = SettingsData & {
    /** Puts a control's change in force at once, and on disk: the Settings screen has no Save. */
    update: (values: Partial<SettingsData>) => void;
    /** Puts every preference back to {@link SETTINGS_DEFAULTS}. */
    reset: () => void;
};

/** What every preference reads as for a user who has never chosen, and after Reset to defaults. */
export const SETTINGS_DEFAULTS: SettingsData = {
    deletionMode: "trash",
    confirmDeletion: true,
    matchThreshold: 80,
    scanSubfolders: false,
    frameRotate: true,
    frameFlip: true,
};

/** The lowest and highest default match threshold, in whole percent. */
export const MATCH_THRESHOLD_MIN = 50;
export const MATCH_THRESHOLD_MAX = 100;

const isMatchThreshold = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MATCH_THRESHOLD_MIN &&
    value <= MATCH_THRESHOLD_MAX;

/** `value` when it is a boolean, else `fallback`. */
const booleanOr = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

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
            // Earlier shapes are subsets of this one, and `merge` defaults whatever they lack, so nothing migrates.
            version: 1,
            // Data only: the actions are rebuilt on every launch.
            partialize: ({
                deletionMode,
                confirmDeletion,
                matchThreshold,
                scanSubfolders,
                frameRotate,
                frameFlip,
            }): SettingsData => ({
                deletionMode,
                confirmDeletion,
                matchThreshold,
                scanSubfolders,
                frameRotate,
                frameFlip,
            }),
            merge: (persisted, current): SettingsStore => {
                // `persist` calls this whether or not anything was stored.
                if (typeof persisted !== "object" || persisted === null) return current;

                const stored = persisted as Partial<Record<keyof SettingsData, unknown>>;

                return {
                    ...current,
                    deletionMode: isDeletionMode(stored.deletionMode)
                        ? stored.deletionMode
                        : SETTINGS_DEFAULTS.deletionMode,
                    confirmDeletion: booleanOr(stored.confirmDeletion, SETTINGS_DEFAULTS.confirmDeletion),
                    matchThreshold: isMatchThreshold(stored.matchThreshold)
                        ? stored.matchThreshold
                        : SETTINGS_DEFAULTS.matchThreshold,
                    scanSubfolders: booleanOr(stored.scanSubfolders, SETTINGS_DEFAULTS.scanSubfolders),
                    frameRotate: booleanOr(stored.frameRotate, SETTINGS_DEFAULTS.frameRotate),
                    frameFlip: booleanOr(stored.frameFlip, SETTINGS_DEFAULTS.frameFlip),
                };
            },
        },
    ),
);
