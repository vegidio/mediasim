import { type RefObject, useEffect } from "react";
import { videoClose, videoNext, videoOpen } from "@/ipc/video";
import type { MsePlan } from "./playChoice";

/** How far ahead of the playhead to keep buffered when the video is copied, in seconds. */
export const AHEAD = 30;

/**
 * How far ahead to keep buffered when the video is encoded, in seconds: five segments. Encoding costs CPU that copying
 * doesn't, so less is made ahead of need; it is still enough to have the first frames ready before play is pressed.
 */
export const ENCODE_AHEAD = 10;

/** How much to keep buffered behind the playhead, in seconds; anything older is removed. */
export const BEHIND = 10;

/** The least the ahead target shrinks to when the buffer is full, in seconds. */
const MIN_AHEAD = 5;

/**
 * How far before a buffered range a time still counts as in it, in seconds: a session's media may begin a moment after
 * its start time, a gap the browser plays across.
 */
const SLACK = 0.5;

/** What {@link useMseSource} plays: an admitted video, remuxed or transcoded as `plan` says. */
export type MseSource = {
    identity: string;
    /** In seconds, from the probe: fragmented MP4 declares none of its own. */
    duration: number;
    plan: MsePlan;
};

type MediaSourceClass = typeof MediaSource;

/**
 * The window's `MediaSource`, or WebKit's `ManagedMediaSource` where only that exists, or `undefined` when it has no
 * Media Source Extensions.
 */
export const mediaSourceClass = (): MediaSourceClass | undefined => {
    const scope = globalThis as { MediaSource?: MediaSourceClass; ManagedMediaSource?: MediaSourceClass };
    return scope.MediaSource ?? scope.ManagedMediaSource;
};

/** Resolves once `buffer` has finished its update, or rejects if the update failed. */
const updated = (buffer: SourceBuffer) =>
    new Promise<void>((resolve, reject) => {
        const done = () => {
            buffer.removeEventListener("error", failed);
            resolve();
        };
        const failed = () => {
            buffer.removeEventListener("updateend", done);
            reject(new Error("the source buffer failed to update"));
        };
        buffer.addEventListener("updateend", done, { once: true });
        buffer.addEventListener("error", failed, { once: true });
    });

/** The end of the range of `ranges` holding `time`, in seconds. */
const rangeEndAt = (ranges: TimeRanges, time: number): number | undefined => {
    for (let index = 0; index < ranges.length; index++) {
        if (ranges.start(index) - SLACK <= time && time <= ranges.end(index)) return ranges.end(index);
    }
    return;
};

/**
 * Whether the buffer needs another segment for the playhead at `time`: when nothing is buffered yet, or less than
 * `ahead` seconds past it. Never when `time` is outside what is buffered, which only a seek does, and the seek reopens.
 */
const wantsMore = (ranges: TimeRanges, time: number, ahead: number) => {
    if (ranges.length === 0) return true;
    const end = rangeEndAt(ranges, time);
    return end !== undefined && end - time < ahead;
};

const isQuotaExceeded = (error: unknown) => error instanceof DOMException && error.name === "QuotaExceededError";

/**
 * Plays `source` in the `<video>` in `ref` through Media Source Extensions, from a session carrying its streams as the
 * plan says, while the caller is mounted and `source` is set.
 *
 * Once the source opens, it sets the duration from the probe, opens a session at 0 and appends its init segment. It
 * then keeps {@link AHEAD} seconds buffered ahead of the playhead, or {@link ENCODE_AHEAD} when the video is encoded,
 * asking for one segment at a time, and removes what is more than {@link BEHIND} seconds behind it. This starts at
 * mount, before any play, so the first segments are ready by the time the user presses play. An empty segment ends
 * the stream. A seek outside what is buffered closes the session and opens another at the target, placed at its start
 * time with `timestampOffset`, since every session's media begins at 0.
 *
 * A refused request or a failed append ends the stream with a decode error, so the element dispatches `error`, which
 * is what the player shows. On unmount it closes the session, revokes the object URL and clears the element.
 */
export const useMseSource = (ref: RefObject<HTMLVideoElement | null>, source?: MseSource) => {
    useEffect(() => {
        const element = ref.current;
        if (!element || !source) return;
        const { identity, duration, plan } = source;

        const Source = mediaSourceClass();
        if (!Source) {
            element.dispatchEvent(new Event("error"));
            return;
        }
        const mediaSource = new Source();
        const url = URL.createObjectURL(mediaSource);

        let alive = true;
        /** Bumped by each reopen, which makes the work of the one before it stale. */
        let generation = 0;
        let session: number | undefined;
        let buffer: SourceBuffer | undefined;
        let ended = false;
        let ahead = plan.video === "encode" ? ENCODE_AHEAD : AHEAD;
        let pumping = false;
        /** Every change to the buffer runs in turn, in this chain. */
        let queue = Promise.resolve();

        const stale = (asOf: number) => !alive || asOf !== generation;

        const closeSession = () => {
            if (session === undefined) return;
            videoClose(session).catch(() => {});
            session = undefined;
        };

        const fail = () => {
            if (!alive) return;
            alive = false;
            closeSession();
            if (mediaSource.readyState === "open") mediaSource.endOfStream("decode");
            else element.dispatchEvent(new Event("error"));
        };

        /** Runs `work` after everything queued before it, failing the element if it throws while still current. */
        const enqueue = (asOf: number, work: () => Promise<void>) => {
            queue = queue.then(work).catch(() => {
                if (!stale(asOf)) fail();
            });
        };

        const append = async (target: SourceBuffer, data: ArrayBuffer) => {
            target.appendBuffer(data);
            await updated(target);
        };

        const remove = async (target: SourceBuffer, start: number, end: number) => {
            if (end <= start) return;
            target.remove(start, end);
            await updated(target);
        };

        const evict = (target: SourceBuffer) => {
            const { buffered } = target;
            const until = element.currentTime - BEHIND;
            return buffered.length > 0 && buffered.start(0) < until ? remove(target, 0, until) : Promise.resolve();
        };

        /** Appends a fragment; when the buffer is full, shrinks the ahead target, evicts, and tries once more. */
        const appendFragment = async (target: SourceBuffer, data: ArrayBuffer) => {
            try {
                await append(target, data);
            } catch (error) {
                if (!isQuotaExceeded(error)) throw error;
                ahead = Math.max(MIN_AHEAD, ahead / 2);
                await evict(target);
                await append(target, data);
            }
        };

        /** Opens a session at `at` and appends its init segment. Resolves to whether it is still current. */
        const open = async (target: SourceBuffer, at: number, asOf: number) => {
            const opened = await videoOpen(identity, at, { video: plan.video, audio: plan.audio });
            if (stale(asOf)) {
                videoClose(opened.session).catch(() => {});
                return false;
            }
            session = opened.session;
            ended = false;

            const init = await videoNext(opened.session);
            if (stale(asOf)) return false;
            await append(target, init);
            target.timestampOffset = opened.start;
            return !stale(asOf);
        };

        /** Requests and appends segments until `ahead` seconds are buffered or the stream ends. */
        const pump = async (target: SourceBuffer, asOf: number) => {
            while (!stale(asOf) && !ended && session !== undefined) {
                if (!wantsMore(target.buffered, element.currentTime, ahead)) return;

                const segment = await videoNext(session);
                if (stale(asOf)) return;
                if (segment.byteLength === 0) {
                    ended = true;
                    if (mediaSource.readyState === "open") mediaSource.endOfStream();
                    return;
                }

                await appendFragment(target, segment);
                await evict(target);
            }
        };

        /** Tops the buffer up, unless that is already under way. */
        const kick = () => {
            const target = buffer;
            if (!target || pumping || ended) return;
            const asOf = generation;
            pumping = true;
            enqueue(asOf, async () => {
                try {
                    await pump(target, asOf);
                } finally {
                    pumping = false;
                }
            });
        };

        const onSourceOpen = () => {
            // It fires again when an ended stream reopens for a seek, which needs nothing from here.
            mediaSource.removeEventListener("sourceopen", onSourceOpen);
            if (Number.isFinite(duration) && duration > 0) mediaSource.duration = duration;
            const target = mediaSource.addSourceBuffer(plan.mime);
            buffer = target;

            const asOf = generation;
            enqueue(asOf, async () => {
                if (await open(target, 0, asOf)) await pump(target, asOf);
            });
        };

        const onSeeking = () => {
            const target = buffer;
            const time = element.currentTime;
            if (!target || rangeEndAt(target.buffered, time) !== undefined) return;

            const asOf = ++generation;
            closeSession();
            pumping = false;
            enqueue(asOf, async () => {
                if (stale(asOf)) return;
                if (target.updating) target.abort();
                await remove(target, 0, Number.POSITIVE_INFINITY);
                if (await open(target, time, asOf)) await pump(target, asOf);
            });
        };

        mediaSource.addEventListener("sourceopen", onSourceOpen);
        element.addEventListener("seeking", onSeeking);
        element.addEventListener("timeupdate", kick);
        element.addEventListener("seeked", kick);
        if (Source !== globalThis.MediaSource) element.disableRemotePlayback = true;
        element.src = url;

        return () => {
            alive = false;
            mediaSource.removeEventListener("sourceopen", onSourceOpen);
            element.removeEventListener("seeking", onSeeking);
            element.removeEventListener("timeupdate", kick);
            element.removeEventListener("seeked", kick);
            closeSession();
            element.pause();
            element.removeAttribute("src");
            element.load();
            URL.revokeObjectURL(url);
        };
    }, [ref, source]);
};
