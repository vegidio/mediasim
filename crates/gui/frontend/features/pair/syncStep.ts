/** How far apart, in seconds, two videos played in step may drift before the follower is brought back. */
export const SYNC_TOLERANCE = 0.1;

/**
 * How long, in milliseconds, to leave the follower alone after a correction. A seek while playing stalls it for a few
 * hundred milliseconds in WebKit, during which its drift reads wrong; it has settled within a second.
 */
export const SYNC_COOLDOWN = 1000;

/** The most the follower is ever seeked ahead of the leader, in seconds. */
const MAX_LEAD = 1;

/** What {@link syncStep} reads of one `<video>`. */
export type SyncReading = {
    time: number;
    /** In seconds, once the element knows it. */
    duration?: number;
    paused: boolean;
    ended: boolean;
};

/** What {@link syncStep} reads of the pair beyond the two elements. */
export type SyncContext = {
    /** Whether the user asked to play. */
    playing: boolean;
    /** How far ahead of the leader to seek the follower, in seconds, to make up for the stall the seek causes. */
    lead: number;
    /** Milliseconds since the follower was last corrected. */
    sinceCorrection: number;
};

/** What to do to the follower. */
export type SyncAction = { kind: "none" } | { kind: "seek"; time: number } | { kind: "play" } | { kind: "pause" };

const NONE: SyncAction = { kind: "none" };

/**
 * The one step that keeps `follower` in step with `leader`, the longer video, which plays freely. The follower's
 * target is the leader's time, held at its own end when it is the shorter one, where it stays on its last frame.
 */
export const syncStep = (leader: SyncReading, follower: SyncReading, context: SyncContext): SyncAction => {
    if (!context.playing) return follower.paused ? NONE : { kind: "pause" };

    const end = follower.duration ?? Number.POSITIVE_INFINITY;
    const target = Math.min(leader.time, end);
    // At or past its end, it is left ended on its last frame, or to play on into it if it is a moment short.
    if (target >= end) return NONE;

    if (follower.ended) {
        // Ended a moment before the leader reached the same point, as an equally long follower can: in step already.
        if (end - target <= SYNC_TOLERANCE) return NONE;
        // Before its end again, after a seek back: an ended element's `play()` restarts it from 0, so it is moved first.
        return { kind: "seek", time: target };
    }

    const drift = target - follower.time;
    if (Math.abs(drift) > SYNC_TOLERANCE) {
        // A paused follower doesn't stall on a seek, so it needs neither the lead nor the cooldown.
        if (follower.paused) return { kind: "seek", time: target };
        if (context.sinceCorrection >= SYNC_COOLDOWN) {
            return { kind: "seek", time: Math.min(target + context.lead, end) };
        }
        return NONE;
    }

    return follower.paused ? { kind: "play" } : NONE;
};

/**
 * The lead to use for the next correction, given the one used for the last and the drift it left once settled:
 * positive when the follower still trails. Engines that don't stall on a seek leave none, and keep a lead of 0.
 */
export const nextLead = (lead: number, drift: number) => Math.min(MAX_LEAD, Math.max(0, lead + drift));
