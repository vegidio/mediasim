import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { nextLead, SYNC_COOLDOWN, type SyncReading, syncStep } from "./syncStep";
import type { VideoPlayback, VideoPlaybackState } from "./useVideoPlayback";

type VideoRef = RefObject<HTMLVideoElement | null>;

const INITIAL: VideoPlaybackState = { playing: false, time: 0, muted: true, started: false, failed: false };

/** The events whose state {@link useSyncedPlayback} reads afresh. */
const SYNCED = ["play", "pause", "timeupdate", "durationchange", "volumechange", "ended", "emptied", "seeked"] as const;

/** An element's duration, once it knows it. */
const knownDuration = (video: HTMLVideoElement) =>
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;

const reading = (video: HTMLVideoElement): SyncReading => {
    const duration = knownDuration(video);
    return {
        time: video.currentTime,
        ...(duration !== undefined && { duration }),
        paused: video.paused,
        ended: video.ended,
    };
};

/** Plays `video`; one that can't also dispatches `error`, which is what the player shows. */
const play = (video: HTMLVideoElement) => {
    video.play().catch(() => {});
};

/** The leader and the follower: the longer video leads, or A while they are equal or a duration is unknown. */
const roles = (a: HTMLVideoElement, b: HTMLVideoElement): [HTMLVideoElement, HTMLVideoElement] =>
    (knownDuration(b) ?? 0) > (knownDuration(a) ?? Number.POSITIVE_INFINITY) ? [b, a] : [a, b];

/** What the driver keeps between events, none of which the player shows. */
type Driver = {
    /** Whether the user asked to play, which a stall's pause doesn't change. */
    intent: boolean;
    /** How far ahead of the leader to seek the follower, learnt from each correction. */
    lead: number;
    /** When the follower was last corrected or both were seeked, from `performance.now()`. */
    lastCorrection: number;
    /** Whether the last correction's leftover drift is still to be learnt from. */
    pending: boolean;
    /** The elements waiting for data, which the other waits for. */
    waiting: Set<HTMLVideoElement>;
};

/**
 * Plays the two `<video>` elements in `refA` and `refB` in step, as one {@link VideoPlayback} for one player bar.
 *
 * The longer video leads and plays freely; the bar's time and seek bar follow it. The other follows it, kept within
 * the tolerance by {@link syncStep}, and holds its last frame once past its end. Either waiting for data pauses the
 * other until it can play on. Only A's sound can ever play: B is kept muted.
 */
export const useSyncedPlayback = (refA: VideoRef, refB: VideoRef): VideoPlayback => {
    const [state, setState] = useState(INITIAL);
    const driver = useRef<Driver>({
        intent: false,
        lead: 0,
        lastCorrection: Number.NEGATIVE_INFINITY,
        pending: false,
        waiting: new Set(),
    });

    const setIntent = useCallback((intent: boolean) => {
        driver.current.intent = intent;
        setState((previous) => ({ ...previous, playing: intent }));
    }, []);

    /** Brings the follower in step with the leader, unless either is waiting for data. */
    const step = useCallback(() => {
        const a = refA.current;
        const b = refB.current;
        if (!a || !b) return;
        const self = driver.current;
        if (self.waiting.size > 0) return;

        const [leader, follower] = roles(a, b);
        const now = performance.now();
        const sinceCorrection = now - self.lastCorrection;

        // Once the last correction has settled, what it left over teaches the lead for the next one.
        if (self.pending && sinceCorrection >= SYNC_COOLDOWN) {
            self.pending = false;
            const end = knownDuration(follower) ?? Number.POSITIVE_INFINITY;
            const target = Math.min(leader.currentTime, end);
            if (self.intent && !follower.paused && target < end) {
                self.lead = nextLead(self.lead, target - follower.currentTime);
            }
        }

        const action = syncStep(reading(leader), reading(follower), {
            playing: self.intent,
            lead: self.lead,
            sinceCorrection,
        });
        switch (action.kind) {
            case "seek": {
                const wasPlaying = !follower.paused;
                follower.currentTime = action.time;
                if (wasPlaying) {
                    self.lastCorrection = now;
                    self.pending = true;
                } else {
                    // Moved while paused, it may now need to play.
                    step();
                }
                break;
            }
            case "play":
                play(follower);
                break;
            case "pause":
                follower.pause();
                break;
        }
    }, [refA, refB]);

    const pauseBoth = () => {
        refA.current?.pause();
        refB.current?.pause();
    };

    useEffect(() => {
        const a = refA.current;
        const b = refB.current;
        if (!a || !b) return;
        const self = driver.current;

        const sync = () =>
            setState((previous) => {
                const [leader] = roles(a, b);
                const durationA = knownDuration(a);
                const durationB = knownDuration(b);
                const { duration: _, ...rest } = previous;
                return {
                    ...rest,
                    time: leader.currentTime,
                    muted: a.muted,
                    ...(durationA !== undefined &&
                        durationB !== undefined && { duration: Math.max(durationA, durationB) }),
                };
            });
        const start = () => setState((previous) => ({ ...previous, started: true }));
        const fail = () => {
            setState((previous) => ({ ...previous, failed: true }));
            setIntent(false);
            self.waiting.clear();
            a.pause();
            b.pause();
        };

        /** Runs a step on the leader's own events only: the follower's would correct it against itself. */
        const onLeader = (event: Event) => {
            if (event.currentTarget === roles(a, b)[0]) step();
        };
        const onEnded = (event: Event) => {
            if (event.currentTarget !== roles(a, b)[0]) return;
            // The leader's end is the pair's: both stay on their last frames.
            setIntent(false);
            step();
        };
        const onWaiting = (event: Event) => {
            if (!self.intent) return;
            const waiting = event.currentTarget as HTMLVideoElement;
            self.waiting.add(waiting);
            (waiting === a ? b : a).pause();
        };
        const onReady = (event: Event) => {
            if (!self.waiting.delete(event.currentTarget as HTMLVideoElement)) return;
            if (self.waiting.size > 0 || !self.intent) return;
            // Both play on together: the leader here, the follower in step with it.
            const [leader] = roles(a, b);
            if (leader.paused && !leader.ended) play(leader);
            step();
        };
        const keepMuted = () => {
            if (!b.muted) b.muted = true;
        };

        for (const video of [a, b]) {
            for (const event of SYNCED) video.addEventListener(event, sync);
            video.addEventListener("play", start);
            video.addEventListener("error", fail);
            for (const event of ["timeupdate", "seeked", "play"]) video.addEventListener(event, onLeader);
            video.addEventListener("ended", onEnded);
            video.addEventListener("waiting", onWaiting);
            video.addEventListener("playing", onReady);
            video.addEventListener("canplay", onReady);
        }
        b.addEventListener("volumechange", keepMuted);
        keepMuted();
        sync();
        // The elements start loading as soon as they are created, so either may have failed before these listeners.
        if (a.error || b.error) fail();

        return () => {
            for (const video of [a, b]) {
                for (const event of SYNCED) video.removeEventListener(event, sync);
                video.removeEventListener("play", start);
                video.removeEventListener("error", fail);
                for (const event of ["timeupdate", "seeked", "play"]) video.removeEventListener(event, onLeader);
                video.removeEventListener("ended", onEnded);
                video.removeEventListener("waiting", onWaiting);
                video.removeEventListener("playing", onReady);
                video.removeEventListener("canplay", onReady);
            }
            b.removeEventListener("volumechange", keepMuted);
        };
    }, [refA, refB, step, setIntent]);

    const toggle = () => {
        const a = refA.current;
        const b = refB.current;
        if (!a || !b) return;
        const self = driver.current;

        if (self.intent) {
            setIntent(false);
            self.waiting.clear();
            pauseBoth();
            return;
        }

        const [leader] = roles(a, b);
        if (leader.ended) {
            a.currentTime = 0;
            b.currentTime = 0;
        }
        setIntent(true);
        play(leader);
        step();
    };

    const seek = (time: number) => {
        const a = refA.current;
        const b = refB.current;
        if (!a || !b) return;

        for (const video of [a, b]) video.currentTime = Math.min(time, knownDuration(video) ?? time);
        // Both stall alike on a seek; they are left to settle before any correction.
        driver.current.lastCorrection = performance.now();
        driver.current.pending = false;
        step();
    };

    const toggleMute = () => {
        if (refA.current) refA.current.muted = !refA.current.muted;
    };

    return { ...state, toggle, seek, toggleMute };
};
