import { type DragDropEvent, getCurrentWebview } from "@tauri-apps/api/webview";

export type { DragDropEvent };

/**
 * Listen to files dragged from the operating system over the window: `enter`, `over`, `drop` and `leave`, with real
 * filesystem paths and a position in physical pixels from the webview's top-left corner. HTML5 drop events carry no
 * paths in a webview, which is why this goes through Tauri.
 *
 * Returns a function that stops listening, which works even before Tauri has finished registering the listener.
 */
export const onDragDrop = (handler: (event: DragDropEvent) => void) => {
    let stopped = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
        .onDragDropEvent((event) => handler(event.payload))
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
