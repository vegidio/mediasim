import { create } from "zustand";

/** The screens the window switches between, inside the same shell. */
export type Screen = "home" | "gallery" | "pair" | "settings";

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
}));
