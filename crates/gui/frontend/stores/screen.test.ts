import { beforeEach, describe, expect, it } from "vitest";
import { useScreenStore } from "./screen";

beforeEach(() => {
    useScreenStore.setState({ screen: "home", returnTo: "home" });
    useScreenStore.getState().takePrevious();
});

describe("useScreenStore", () => {
    it.each(["home", "pair"] as const)("returns from Settings to %s", (from) => {
        useScreenStore.getState().show(from);

        useScreenStore.getState().openSettings();
        expect(useScreenStore.getState().screen).toBe("settings");

        useScreenStore.getState().closeSettings();
        expect(useScreenStore.getState().screen).toBe(from);
    });

    it("does nothing when opening Settings on Settings", () => {
        useScreenStore.getState().show("pair");
        useScreenStore.getState().openSettings();

        useScreenStore.getState().openSettings();
        useScreenStore.getState().closeSettings();

        expect(useScreenStore.getState().screen).toBe("pair");
    });

    it("reads Settings as the previous screen after closing it", () => {
        useScreenStore.getState().show("pair");
        useScreenStore.getState().openSettings();

        useScreenStore.getState().closeSettings();

        expect(useScreenStore.getState().takePrevious()).toBe("settings");
    });

    describe("redirect", () => {
        it("swaps the screen shown", () => {
            useScreenStore.getState().show("scan");

            useScreenStore.getState().redirect("scan", "groups");

            expect(useScreenStore.getState().screen).toBe("groups");
        });

        it("makes Settings return to the new screen", () => {
            useScreenStore.getState().show("scan");
            useScreenStore.getState().openSettings();

            useScreenStore.getState().redirect("scan", "groups");
            expect(useScreenStore.getState().screen).toBe("settings");

            useScreenStore.getState().closeSettings();
            expect(useScreenStore.getState().screen).toBe("groups");
        });

        it("does nothing on another screen", () => {
            useScreenStore.getState().show("gallery");

            useScreenStore.getState().redirect("scan", "groups");

            expect(useScreenStore.getState().screen).toBe("gallery");
        });

        it("does nothing on Settings opened from another screen", () => {
            useScreenStore.getState().show("gallery");
            useScreenStore.getState().openSettings();

            useScreenStore.getState().redirect("scan", "groups");
            useScreenStore.getState().closeSettings();

            expect(useScreenStore.getState().screen).toBe("gallery");
        });
    });
});
