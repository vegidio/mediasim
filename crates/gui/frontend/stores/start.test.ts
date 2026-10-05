import { beforeEach, describe, expect, it } from "vitest";
import { useStartStore } from "@/stores/start";

describe("useStartStore", () => {
    beforeEach(() => {
        useStartStore.setState(useStartStore.getInitialState(), true);
    });

    it("starts with subfolders scanned", () => {
        expect(useStartStore.getState().scanSubfolders).toBe(true);
    });

    it("toggles scanning subfolders", () => {
        useStartStore.getState().toggleScanSubfolders();
        expect(useStartStore.getState().scanSubfolders).toBe(false);

        useStartStore.getState().toggleScanSubfolders();
        expect(useStartStore.getState().scanSubfolders).toBe(true);
    });
});
