import { getCurrentWebview, type DragDropEvent as TauriDragDropEvent } from "@tauri-apps/api/webview";
import { isWindows } from "./os";

/** A position in CSS pixels from the webview's top-left corner. */
export type Point = { x: number; y: number };

/** A file drag over the window, with its position in CSS pixels. */
export type DragDropEvent =
    | { type: "enter"; paths: string[]; position: Point }
    | { type: "over"; position: Point }
    | { type: "drop"; paths: string[]; position: Point }
    | { type: "leave" };

/**
 * A position from Tauri in CSS pixels. Tauri calls it physical, but only WebView2 on Windows reports physical pixels:
 * WKWebView on macOS and WebKitGTK on Linux report points, which are already CSS pixels.
 */
const toCss = ({ x, y }: Point): Point => {
    const ratio = isWindows() ? window.devicePixelRatio || 1 : 1;
    return { x: x / ratio, y: y / ratio };
};

const normalise = (event: TauriDragDropEvent): DragDropEvent => {
    switch (event.type) {
        case "enter":
        case "drop":
            return { type: event.type, paths: event.paths, position: toCss(event.position) };
        case "over":
            return { type: "over", position: toCss(event.position) };
        case "leave":
            return { type: "leave" };
    }
};

/**
 * Listen to files dragged from the operating system over the window: `enter`, `over`, `drop` and `leave`, with real
 * filesystem paths and a position in CSS pixels from the webview's top-left corner. HTML5 drop events carry no paths
 * in a webview, which is why this goes through Tauri.
 *
 * Returns a function that stops listening, which works even before Tauri has finished registering the listener.
 */
export const onDragDrop = (handler: (event: DragDropEvent) => void) => {
    let stopped = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
        .onDragDropEvent((event) => handler(normalise(event.payload)))
        .then(
            (stop) => {
                if (stopped) stop();
                else unlisten = stop;
            },
            (error: unknown) => console.error("could not listen to drag and drop", error),
        );

    return () => {
        stopped = true;
        unlisten?.();
    };
};
