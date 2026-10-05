import { getCurrentWebview } from "@tauri-apps/api/webview";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { onDragDrop } from "./dragDrop";
import { isWindows } from "./os";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("./os", () => ({ isWindows: vi.fn(() => false) }));

/** A webview whose registration resolves when the test says so. */
const webview = () => {
    const unlisten = vi.fn();
    let register: (stop: () => void) => void = () => {};
    let callback: (event: { payload: unknown }) => void = () => {};
    const onDragDropEvent = vi.fn((cb: typeof callback) => {
        callback = cb;
        return new Promise<() => void>((resolve) => {
            register = resolve;
        });
    });
    (getCurrentWebview as Mock).mockReturnValue({ onDragDropEvent });

    return { unlisten, registered: () => register(unlisten), emit: (payload: unknown) => callback({ payload }) };
};

describe("onDragDrop", () => {
    beforeEach(() => {
        vi.stubGlobal("devicePixelRatio", 2);
    });

    it("hands each event's payload to the handler", () => {
        const view = webview();
        const handler = vi.fn();

        onDragDrop(handler);
        view.emit({ type: "leave" });

        expect(handler).toHaveBeenCalledExactlyOnceWith({ type: "leave" });
    });

    it("keeps positions as they are on macOS and Linux, which report points", () => {
        const view = webview();
        const handler = vi.fn();

        onDragDrop(handler);
        view.emit({ type: "enter", paths: ["/a.jpg"], position: { x: 300, y: 200 } });
        view.emit({ type: "over", position: { x: 310, y: 210 } });
        view.emit({ type: "drop", paths: ["/a.jpg"], position: { x: 320, y: 220 } });

        expect(handler.mock.calls).toEqual([
            [{ type: "enter", paths: ["/a.jpg"], position: { x: 300, y: 200 } }],
            [{ type: "over", position: { x: 310, y: 210 } }],
            [{ type: "drop", paths: ["/a.jpg"], position: { x: 320, y: 220 } }],
        ]);
    });

    it("turns physical pixels into CSS pixels on Windows", () => {
        (isWindows as Mock).mockReturnValue(true);
        const view = webview();
        const handler = vi.fn();

        onDragDrop(handler);
        view.emit({ type: "drop", paths: ["/a.jpg"], position: { x: 600, y: 400 } });

        expect(handler).toHaveBeenCalledExactlyOnceWith({
            type: "drop",
            paths: ["/a.jpg"],
            position: { x: 300, y: 200 },
        });
    });

    it("stops listening once registered", async () => {
        const view = webview();
        const stop = onDragDrop(vi.fn());

        view.registered();
        await Promise.resolve();
        stop();

        expect(view.unlisten).toHaveBeenCalledOnce();
    });

    it("stops listening when stopped before the registration finished", async () => {
        const view = webview();
        const stop = onDragDrop(vi.fn());

        stop();
        view.registered();
        await vi.waitFor(() => expect(view.unlisten).toHaveBeenCalledOnce());
    });
});
