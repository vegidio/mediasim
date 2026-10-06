import { describe, expect, it } from "vitest";
import { nextLead, SYNC_COOLDOWN, type SyncContext, type SyncReading, syncStep } from "./syncStep";

const reading = (state: Partial<SyncReading> = {}): SyncReading => ({
    time: 10,
    duration: 42,
    paused: false,
    ended: false,
    ...state,
});

const PLAYING: SyncContext = { playing: true, lead: 0, sinceCorrection: SYNC_COOLDOWN };

describe("syncStep", () => {
    it.each([
        ["in step", reading(), reading(), PLAYING, { kind: "none" }],
        ["within the tolerance", reading(), reading({ time: 9.95 }), PLAYING, { kind: "none" }],
        ["0.3 s behind", reading(), reading({ time: 9.7 }), PLAYING, { kind: "seek", time: 10 }],
        ["0.3 s ahead", reading(), reading({ time: 10.3 }), PLAYING, { kind: "seek", time: 10 }],
        [
            "behind, with a lead",
            reading(),
            reading({ time: 9.7 }),
            { ...PLAYING, lead: 0.45 },
            { kind: "seek", time: 10.45 },
        ],
        [
            "behind, with a lead past its end",
            reading({ time: 29.8 }),
            reading({ time: 29.5, duration: 30 }),
            { ...PLAYING, lead: 0.45 },
            { kind: "seek", time: 30 },
        ],
        [
            "behind, within the cooldown",
            reading(),
            reading({ time: 9.7 }),
            { ...PLAYING, sinceCorrection: SYNC_COOLDOWN - 1 },
            { kind: "none" },
        ],
        [
            "paused and behind, within the cooldown, with a lead",
            reading(),
            reading({ time: 3, paused: true }),
            { ...PLAYING, lead: 0.45, sinceCorrection: 0 },
            { kind: "seek", time: 10 },
        ],
        ["paused before its end, in step", reading(), reading({ paused: true }), PLAYING, { kind: "play" }],
        [
            "ended, with the target before its end",
            reading(),
            reading({ time: 30, duration: 30, paused: true, ended: true }),
            PLAYING,
            { kind: "seek", time: 10 },
        ],
        [
            "ended, with the target just short of its end",
            reading({ time: 41.95 }),
            reading({ time: 42, paused: true, ended: true }),
            PLAYING,
            { kind: "none" },
        ],
        [
            "ended, with the target past its end",
            reading({ time: 36 }),
            reading({ time: 30, duration: 30, paused: true, ended: true }),
            PLAYING,
            { kind: "none" },
        ],
        [
            "short of its end, with the target past it",
            reading({ time: 30.2 }),
            reading({ time: 29.9, duration: 30 }),
            PLAYING,
            { kind: "none" },
        ],
        [
            "paused short of its end, with the target past it",
            reading({ time: 36 }),
            reading({ time: 30, duration: 30, paused: true }),
            PLAYING,
            { kind: "none" },
        ],
        [
            "its duration unknown, behind",
            reading(),
            { time: 9, paused: false, ended: false },
            PLAYING,
            {
                kind: "seek",
                time: 10,
            },
        ],
        ["playing, with the intent paused", reading(), reading(), { ...PLAYING, playing: false }, { kind: "pause" }],
        [
            "paused and behind, with the intent paused",
            reading({ paused: true }),
            reading({ time: 3, paused: true }),
            { ...PLAYING, playing: false },
            { kind: "none" },
        ],
    ] as const)("does the right thing for a follower %s", (_, leader, follower, context, action) => {
        expect(syncStep(leader, follower, context)).toEqual(action);
    });
});

describe("nextLead", () => {
    it.each([
        ["grows by what a correction left behind", 0, 0.47, 0.47],
        ["shrinks by what a correction overshot", 0.47, -0.03, 0.44],
        ["stays at 0 on an engine that doesn't stall", 0, 0.01, 0.01],
        ["never goes below 0", 0.02, -0.3, 0],
        ["never goes above 1", 0.9, 0.5, 1],
    ])("%s", (_, lead, drift, next) => {
        expect(nextLead(lead, drift)).toBeCloseTo(next);
    });
});
