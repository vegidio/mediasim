import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_DEFAULTS, useSettingsStore } from "./settings";

const KEY = "settings-storage";

/** Writes `state` where `persist` keeps it, then rehydrates the store from it, as a launch does. */
const relaunchWith = async (state: unknown) => {
    localStorage.setItem(KEY, JSON.stringify({ state, version: 1 }));
    await useSettingsStore.persist.rehydrate();
};

const data = () => {
    const { deletionMode, confirmDeletion, matchThreshold, scanSubfolders, frameRotate, frameFlip } =
        useSettingsStore.getState();

    return { deletionMode, confirmDeletion, matchThreshold, scanSubfolders, frameRotate, frameFlip };
};

/** A stored record with every setting off its default. */
const CHANGED = {
    deletionMode: "permanent",
    confirmDeletion: false,
    matchThreshold: 90,
    scanSubfolders: true,
    frameRotate: false,
    frameFlip: false,
} as const;

beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    localStorage.clear();
});

describe("useSettingsStore", () => {
    it("starts on the defaults with nothing stored", async () => {
        await useSettingsStore.persist.rehydrate();

        expect(data()).toEqual({
            deletionMode: "trash",
            confirmDeletion: true,
            matchThreshold: 80,
            scanSubfolders: false,
            frameRotate: true,
            frameFlip: true,
        });
    });

    it("restores a stored valid record", async () => {
        await relaunchWith(CHANGED);

        expect(data()).toEqual(CHANGED);
    });

    it("replaces an unknown deletion mode alone, keeping the stored confirm setting", async () => {
        await relaunchWith({ ...CHANGED, deletionMode: "shred" });

        expect(data()).toEqual({ ...CHANGED, deletionMode: "trash" });
    });

    it("replaces a confirm setting that isn't a boolean", async () => {
        await relaunchWith({ ...CHANGED, confirmDeletion: "no" });

        expect(data()).toEqual({ ...CHANGED, confirmDeletion: true });
    });

    it.each([120, 49, 101, 85.5, "90", null])("replaces a match threshold of %j alone with 80", async (threshold) => {
        await relaunchWith({ ...CHANGED, matchThreshold: threshold });

        expect(data()).toEqual({ ...CHANGED, matchThreshold: 80 });
    });

    it.each([50, 100])("keeps a match threshold at the bound %i", async (threshold) => {
        await relaunchWith({ ...CHANGED, matchThreshold: threshold });

        expect(data().matchThreshold).toBe(threshold);
    });

    it.each(["scanSubfolders", "frameRotate", "frameFlip"] as const)(
        "replaces a %s that isn't a boolean alone with its default",
        async (key) => {
            await relaunchWith({ ...CHANGED, [key]: "yes" });

            expect(data()).toEqual({ ...CHANGED, [key]: SETTINGS_DEFAULTS[key] });
        },
    );

    it("keeps an earlier version's two settings and defaults the Comparison ones", async () => {
        await relaunchWith({ deletionMode: "permanent", confirmDeletion: false });

        expect(data()).toEqual({ ...SETTINGS_DEFAULTS, deletionMode: "permanent", confirmDeletion: false });
    });

    it("writes each update to localStorage", () => {
        useSettingsStore.getState().update({ deletionMode: "permanent" });

        expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
            state: { ...SETTINGS_DEFAULTS, deletionMode: "permanent" },
            version: 1,
        });
    });

    it("resets every setting to the defaults", () => {
        useSettingsStore.getState().update(CHANGED);

        useSettingsStore.getState().reset();

        expect(data()).toEqual(SETTINGS_DEFAULTS);
    });

    it("starts on the defaults when localStorage can't be read", async () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("storage is disabled");
        });

        await expect(useSettingsStore.persist.rehydrate()).resolves.toBeUndefined();

        expect(data()).toEqual(SETTINGS_DEFAULTS);
    });
});
