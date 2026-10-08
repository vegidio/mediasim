import { create } from "zustand";

/** The screens the window switches between, inside the same shell. */
export type Screen = "home" | "gallery" | "pair" | "settings" | "scan" | "groups";

type ScreenStore = {
    screen: Screen;
    /** The screen shown before this one, until {@link ScreenStore.takePrevious} reads it. */
    previous?: Screen;
    /** The screen Settings was opened from, which Back returns to. */
    returnTo: Screen;
    show: (screen: Screen) => void;
    /**
     * The screen the user just came back from, read once: later calls give nothing until the screen changes again, so
     * only the first mount after a switch acts on it.
     */
    takePrevious: () => Screen | undefined;
    /** Shows Settings, remembering the screen to come back to. Does nothing on Settings itself. */
    openSettings: () => void;
    /** Leaves Settings for the screen it was opened from. */
    closeSettings: () => void;
    /**
     * Swaps screen `from` for `to`: shows `to` when `from` is shown, and when Settings is shown over `from`, makes its
     * Back return to `to` instead. Does nothing otherwise.
     */
    redirect: (from: Screen, to: Screen) => void;
};

export const useScreenStore = create<ScreenStore>()((set, get) => ({
    screen: "home",
    returnTo: "home",
    show: (screen) => {
        if (screen !== get().screen) set({ screen, previous: get().screen });
    },
    takePrevious: () => {
        const { previous } = get();
        // Replaced whole, since an optional property is left out rather than set to `undefined`.
        if (previous !== undefined) set(({ previous: _, ...rest }) => rest, true);

        return previous;
    },
    openSettings: () => {
        const { screen, show } = get();
        if (screen === "settings") return;

        set({ returnTo: screen });
        show("settings");
    },
    closeSettings: () => {
        const { screen, returnTo, show } = get();
        if (screen === "settings") show(returnTo);
    },
    redirect: (from, to) => {
        const { screen, returnTo, show } = get();
        if (screen === from) show(to);
        else if (screen === "settings" && returnTo === from) set({ returnTo: to });
    },
}));
