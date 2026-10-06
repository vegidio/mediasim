import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_DEFAULTS, useSettingsStore } from "./settings";

const KEY = "settings-storage";

/** Writes `state` where `persist` keeps it, then rehydrates the store from it, as a launch does. */
const relaunchWith = async (state: unknown) => {
    localStorage.setItem(KEY, JSON.stringify({ state, version: 1 }));
    await useSettingsStore.persist.rehydrate();
};

const data = () => {
    const { deletionMode, confirmDeletion } = useSettingsStore.getState();

    return { deletionMode, confirmDeletion };
};

beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    localStorage.clear();
});

describe("useSettingsStore", () => {
    it("starts on the defaults with nothing stored", async () => {
        await useSettingsStore.persist.rehydrate();

        expect(data()).toEqual({ deletionMode: "trash", confirmDeletion: true });
    });

    it("restores a stored valid record", async () => {
        await relaunchWith({ deletionMode: "permanent", confirmDeletion: false });

        expect(data()).toEqual({ deletionMode: "permanent", confirmDeletion: false });
    });

    it("replaces an unknown deletion mode alone, keeping the stored confirm setting", async () => {
        await relaunchWith({ deletionMode: "shred", confirmDeletion: false });

        expect(data()).toEqual({ deletionMode: "trash", confirmDeletion: false });
    });

    it("replaces a confirm setting that isn't a boolean", async () => {
        await relaunchWith({ deletionMode: "permanent", confirmDeletion: "no" });

        expect(data()).toEqual({ deletionMode: "permanent", confirmDeletion: true });
    });

    it("writes each update to localStorage", () => {
        useSettingsStore.getState().update({ deletionMode: "permanent" });

        expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({
            state: { deletionMode: "permanent", confirmDeletion: true },
            version: 1,
        });
    });

    it("resets to the defaults", () => {
        useSettingsStore.getState().update({ deletionMode: "permanent", confirmDeletion: false });

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
