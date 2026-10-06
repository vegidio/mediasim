import { type RefObject, useEffect } from "react";

/**
 * Loads `url` into the `<video>` in `ref` while the caller is mounted, and stops it for good when it unmounts.
 *
 * The source is set here rather than as a prop, so it is set again on every mount: StrictMode's rehearsal unmount clears
 * it, and React wouldn't restore a prop that hasn't changed. Call it after the hooks that listen to the element, so
 * their listeners are in place before loading starts.
 *
 * Unmounting alone leaves the element to be collected, still playing until then. The cleanup silences it at once and
 * releases its decoder and its requests.
 */
export const useVideoSource = (ref: RefObject<HTMLVideoElement | null>, url: string) => {
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        element.src = url;

        return () => {
            element.pause();
            element.removeAttribute("src");
            element.load();
        };
    }, [ref, url]);
};
