import { create } from "zustand";
import { route, type Slot } from "@/features/start/routePairDrop";
import { describeMedia, type MediaFile } from "@/ipc/thumbs";

/** State of the "Compare two files" card, kept for as long as the application runs. */
type PairStore = {
    a?: MediaFile;
    b?: MediaFile;

    /** Put the file at `path` in `slot`, as the slot's picker does. */
    place: (slot: Slot, path: string) => Promise<void>;
    /** Place the files dropped onto the card, `target` being the slot under the drop or `undefined` outside both. */
    drop: (paths: string[], target: Slot | undefined) => Promise<void>;
    /** Empty `slot`. */
    remove: (slot: Slot) => void;
    /** Put `file` back in `slot`, as after a restore from the Trash, only if the slot is empty. */
    refill: (slot: Slot, file: MediaFile) => void;
};

/** Whether one slot holds an image and the other a video. */
export const selectMismatch = ({ a, b }: PairStore) => !!a && !!b && a.type !== b.type;

/** Whether both slots hold a file, and both files are images or both videos. */
export const selectCanCompare = (state: PairStore) => !!state.a && !!state.b && !selectMismatch(state);

/** `state` with `slot` holding `file`, or with it empty when there is none. */
const put = (state: PairStore, slot: Slot, file?: MediaFile): PairStore => {
    const { [slot]: _replaced, ...rest } = state;
    return file ? { ...rest, [slot]: file } : rest;
};

const report = (error: unknown) => console.error("could not describe the files", error);

/** Numbers each action in the order it was started. */
let actions = 0;

export const usePairStore = create<PairStore>()((set, get) => {
    /**
     * Per slot, the action started last among those that will write it. A result is applied only by the action that
     * still owns its slot, so the one started last decides even when an earlier one finishes after it.
     */
    const owners: Record<Slot, number> = { a: 0, b: 0 };

    return {
        place: async (slot, path) => {
            const action = ++actions;
            owners[slot] = action;

            try {
                const [file] = await describeMedia([path]);
                // A path that can't be placed leaves the slot as it was.
                if (file && owners[slot] === action) set((state) => put(state, slot, file), true);
            } catch (error) {
                report(error);
            }
        },

        drop: async (paths, target) => {
            const action = ++actions;

            try {
                const files = (await describeMedia(paths)).filter((file) => file !== undefined);
                const { a, b } = get();

                // Claimed only now: until the files are described, which slots this drop writes is unknown, and one
                // that writes none must not cancel an action still in flight.
                const placed = route(files.length, target, { a: !!a, b: !!b })
                    .map((slot, index) => ({ slot, file: files[index] }))
                    .filter(({ slot }) => owners[slot] < action);
                for (const { slot } of placed) owners[slot] = action;

                set((state) => placed.reduce((next, { slot, file }) => put(next, slot, file), state), true);
            } catch (error) {
                report(error);
            }
        },

        remove: (slot) => {
            owners[slot] = ++actions;
            set((state) => put(state, slot), true);
        },

        refill: (slot, file) => {
            if (get()[slot]) return;
            owners[slot] = ++actions;
            set((state) => put(state, slot, file), true);
        },
    };
});
