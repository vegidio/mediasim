import { create } from "zustand";

/** The screens the window switches between, inside the same shell. */
export type Screen = "start" | "pair";

type ScreenStore = {
    screen: Screen;
    /** The screen shown before this one, until {@link ScreenStore.takePrevious} reads it. */
    previous?: Screen;
    show: (screen: Screen) => void;
    /**
     * The screen the user just came back from, read once: later calls give nothing until the screen changes again, so
     * only the first mount after a switch acts on it.
     */
    takePrevious: () => Screen | undefined;
};

export const useScreenStore = create<ScreenStore>()((set, get) => ({
    screen: "start",
    show: (screen) => {
        if (screen !== get().screen) set({ screen, previous: get().screen });
    },
    takePrevious: () => {
        const { previous } = get();
        // Replaced whole, since an optional property is left out rather than set to `undefined`.
        if (previous !== undefined) set(({ previous: _, ...rest }) => rest, true);

        return previous;
    },
}));
