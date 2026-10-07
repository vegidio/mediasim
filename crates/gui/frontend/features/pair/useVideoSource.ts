import { type RefObject, useEffect, useState } from "react";
import type { MediaFile } from "@/ipc/thumbs";
import { probeVideo, videoUrl } from "@/ipc/video";
import { playChoice, type Webview } from "./playChoice";
import { type MseSource, mediaSourceClass, useMseSource } from "./useMseSource";

/** What a player shows of how its video is fed. */
export type VideoSource = {
    /** Whether it has been decided how to play the video, until which it can't be played. */
    ready: boolean;
    /** Whether the video plays without the sound it has, which can be neither copied nor encoded for the window. */
    noSound: boolean;
};

/** What the window can decode, asked of `element` and of its Media Source Extensions. */
const webview = (element: HTMLVideoElement): Webview => {
    const Source = mediaSourceClass();
    return {
        canPlayType: (type) => element.canPlayType(type),
        ...(Source && { isTypeSupported: (type: string) => Source.isTypeSupported(type) }),
    };
};

/** The decision for one file: whose it is, and what it feeds the element through MSE, if anything. */
type Decision = VideoSource & { identity: string; mse?: MseSource };

/**
 * Decides how to play `file` in the `<video>` in `ref` while the caller is mounted, feeds it, and stops it for good
 * when it unmounts.
 *
 * It probes the file and asks the window what it can decode ({@link playChoice}), then sets the element's source to the
 * file's own bytes, hands it to {@link useMseSource} to play remuxed or transcoded, or dispatches `error` on it, which
 * the player shows as the "Can't play this format yet" note. A probe that is refused does the same.
 *
 * A video that fails before its first frame moves on to the next way to play it that the choice listed, each way at
 * most once: direct, then remux, then transcode. The `error` it failed with is stopped here, before any other listener
 * sees it, so the note never shows in between: call this before the hooks that listen to the element, so its listener
 * comes first. They are in place before loading starts anyway, since the source is only set once the probe answers.
 * An MSE source's failures reach the element as the same `error`, and a refused request falls through the same way:
 * the next plan is refused too, and the note shows.
 *
 * The source is set here rather than as a prop, so it is set again on every mount: StrictMode's rehearsal unmount clears
 * it, and React wouldn't restore a prop that hasn't changed. Unmounting alone leaves the element to be collected, still
 * playing until then; the cleanup silences it at once and releases its decoder and its requests.
 */
export const useVideoSource = (ref: RefObject<HTMLVideoElement | null>, file: MediaFile): VideoSource => {
    const { identity } = file;
    const [decision, setDecision] = useState<Decision>();
    const current = decision?.identity === identity ? decision : undefined;

    useMseSource(ref, current?.mse);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        let alive = true;
        /** The ways to fall back to, in order, while the current one hasn't shown a frame. */
        let fallbacks: MseSource[] = [];

        const onLoadedData = () => {
            fallbacks = [];
        };
        const onError = (event: Event) => {
            const [mse, ...rest] = fallbacks;
            if (!mse) return;
            event.stopImmediatePropagation();
            fallbacks = rest;
            setDecision({ identity, ready: true, noSound: mse.plan.noSound, mse });
        };
        const fail = () => {
            setDecision({ identity, ready: true, noSound: false });
            element.dispatchEvent(new Event("error"));
        };

        element.addEventListener("error", onError);
        element.addEventListener("loadeddata", onLoadedData);

        probeVideo(identity).then(
            (probe) => {
                if (!alive) return;
                const choice = playChoice(probe, webview(element));
                const mseOf = (plan: MseSource["plan"]) => ({ identity, duration: probe.duration, plan });

                switch (choice.kind) {
                    case "direct":
                        fallbacks = choice.fallbacks.map(mseOf);
                        element.src = videoUrl(identity);
                        setDecision({ identity, ready: true, noSound: false });
                        break;
                    case "mse":
                        fallbacks = choice.fallbacks.map(mseOf);
                        setDecision({ identity, ready: true, noSound: choice.plan.noSound, mse: mseOf(choice.plan) });
                        break;
                    case "none":
                        fail();
                        break;
                }
            },
            () => {
                if (alive) fail();
            },
        );

        return () => {
            alive = false;
            element.removeEventListener("error", onError);
            element.removeEventListener("loadeddata", onLoadedData);
            element.pause();
            element.removeAttribute("src");
            element.load();
        };
    }, [ref, identity]);

    return { ready: current?.ready ?? false, noSound: current?.noSound ?? false };
};
