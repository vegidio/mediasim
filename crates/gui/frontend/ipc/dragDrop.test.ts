import { getCurrentWebview } from "@tauri-apps/api/webview";
import { describe, expect, it, type Mock, vi } from "vitest";
import { onDragDrop } from "./dragDrop";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));

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
    it("hands each event's payload to the handler", () => {
        const view = webview();
        const handler = vi.fn();

        onDragDrop(handler);
        view.emit({ type: "leave" });

        expect(handler).toHaveBeenCalledExactlyOnceWith({ type: "leave" });
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
