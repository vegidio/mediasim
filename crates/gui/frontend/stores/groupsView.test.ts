import { beforeEach, describe, expect, it } from "vitest";
import { useGroupsViewStore } from "./groupsView";

const KEY = "groups-view-storage";

/** Writes `state` where `persist` keeps it, then rehydrates the store from it, as a launch does. */
const relaunchWith = async (state: unknown) => {
    localStorage.setItem(KEY, JSON.stringify({ state, version: 1 }));
    await useGroupsViewStore.persist.rehydrate();
};

beforeEach(() => {
    localStorage.clear();
    useGroupsViewStore.setState({ layout: "cards" });
    localStorage.clear();
});

describe("useGroupsViewStore", () => {
    it("starts on cards with nothing stored", async () => {
        await useGroupsViewStore.persist.rehydrate();

        expect(useGroupsViewStore.getState().layout).toBe("cards");
    });

    it("restores a stored list layout", async () => {
        await relaunchWith({ layout: "list" });

        expect(useGroupsViewStore.getState().layout).toBe("list");
    });

    it("falls back to cards for a value it doesn't recognise", async () => {
        useGroupsViewStore.setState({ layout: "list" });
        await relaunchWith({ layout: "grid" });

        expect(useGroupsViewStore.getState().layout).toBe("cards");
    });

    it("writes a change to storage", () => {
        useGroupsViewStore.getState().setLayout("list");

        expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").state).toEqual({ layout: "list" });
    });
});
