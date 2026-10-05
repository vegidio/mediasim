import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { cancelComparison, comparePair, probeMedia } from "@/ipc/pair";
import type { MediaFile } from "@/ipc/thumbs";
import { usePairResultStore } from "@/stores/pairResult";
import { usePairViewStore } from "@/stores/pairView";
import { useScreenStore } from "@/stores/screen";

vi.mock("@/ipc/pair", () => ({ probeMedia: vi.fn(), comparePair: vi.fn(), cancelComparison: vi.fn() }));

const media = (name: string): MediaFile => ({
    path: `/media/${name}`,
    name,
    type: "image",
    size: 1000,
    identity: `id-${name}`,
});

const A = media("IMG_2041.jpg");
const B = media("IMG_2041-edit.jpg");

const view = () => usePairViewStore.getState();

describe("usePairViewStore", () => {
    beforeEach(() => {
        usePairViewStore.setState(usePairViewStore.getInitialState(), true);
        usePairResultStore.setState(usePairResultStore.getInitialState(), true);
        useScreenStore.setState(useScreenStore.getInitialState(), true);
        (probeMedia as Mock).mockReset().mockReturnValue(new Promise(() => {}));
        (comparePair as Mock).mockReset().mockReturnValue(new Promise(() => {}));
        (cancelComparison as Mock).mockReset().mockResolvedValue(undefined);
    });

    it("starts side by side, with the handle in the middle", () => {
        expect(view().mode).toBe("side");
        expect(view().position).toBe(50);
    });

    it("sets the mode and the position", () => {
        view().setMode("slider");
        view().setPosition(30.5);

        expect(view().mode).toBe("slider");
        expect(view().position).toBe(30.5);
    });

    it("clamps the position to 0–100", () => {
        view().setPosition(-5);
        expect(view().position).toBe(0);

        view().setPosition(140);
        expect(view().position).toBe(100);
    });

    it("resets the position to the middle", () => {
        view().setPosition(30);

        view().resetPosition();

        expect(view().position).toBe(50);
    });

    it("resets the position, and keeps the mode, when a pair opens", () => {
        view().setMode("slider");
        view().setPosition(30);

        usePairResultStore.getState().open(A, B);

        expect(view().position).toBe(50);
        expect(view().mode).toBe("slider");
    });

    it("keeps the mode and the position through a retry and leaving", () => {
        usePairResultStore.getState().open(A, B);
        view().setMode("slider");
        view().setPosition(30);

        usePairResultStore.getState().retry();
        usePairResultStore.getState().leave();

        expect(view().mode).toBe("slider");
        expect(view().position).toBe(30);
    });
});
