// The `/vitest` entry point declares the matchers against Vitest's `Assertion` interface.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
// Media Source Extensions and object URLs, which jsdom lacks.
import "./mediaSource";

// Registered by hand because `globals` is off in vite.config.ts, and Testing Library's automatic cleanup hooks onto a
// global `afterEach`.
afterEach(cleanup);

// jsdom has no layout, so it leaves out `ResizeObserver`; Radix Slider measures its thumb with one. Nothing is ever
// resized here, so an observer that never reports is faithful.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

// jsdom has no layout, so it leaves out `scrollIntoView`; nothing scrolls here, so it does nothing.
Element.prototype.scrollIntoView ??= () => {};

// jsdom evaluates no media queries, so it leaves out `matchMedia`; this stands for a screen that matches none of them,
// as one with no preference for reduced motion does. A test that needs one to match mocks it.
window.matchMedia ??= (query) => ({
    matches: false,
    media: query,
    // The DOM spells "no handler" as `null`.
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
});

/** What the media element stub below keeps for each element, as a browser would after loading its metadata. */
type MediaState = { currentTime: number; duration: number; muted: boolean; paused: boolean; ended: boolean };

const mediaStates = new WeakMap<HTMLMediaElement, MediaState>();
const mediaErrors = new WeakMap<HTMLMediaElement, MediaError>();

const mediaState = (element: HTMLMediaElement) => {
    let state = mediaStates.get(element);
    if (!state) {
        state = { currentTime: 0, duration: Number.NaN, muted: false, paused: true, ended: false };
        mediaStates.set(element, state);
    }
    return state;
};

/** A media property that reads and writes the element's state, dispatching `event` when it is set. */
const mediaProperty = <K extends keyof MediaState>(key: K, event?: string, onSet?: (state: MediaState) => void) => ({
    configurable: true,
    get(this: HTMLMediaElement) {
        return mediaState(this)[key];
    },
    set(this: HTMLMediaElement, value: MediaState[K]) {
        const state = mediaState(this);
        state[key] = value;
        onSet?.(state);
        if (event) this.dispatchEvent(new Event(event));
    },
});

// jsdom implements no playback: `play`, `pause` and `load` only log "not implemented", and the state is read-only. This
// stub plays nothing either, but keeps the state a player reads and dispatches the events a browser would, so a
// player's behavior can be tested. Tests set `duration`, `ended` and so on to stand for what a real file would do.
Object.defineProperties(HTMLMediaElement.prototype, {
    currentTime: mediaProperty("currentTime", "timeupdate", (state) => {
        state.ended = false;
    }),
    duration: mediaProperty("duration", "durationchange"),
    muted: mediaProperty("muted", "volumechange"),
    paused: mediaProperty("paused"),
    // Set without an event, to stand for an element that failed before anything listened. The DOM spells "no error"
    // as `null`.
    error: {
        configurable: true,
        get(this: HTMLMediaElement) {
            return mediaErrors.get(this) ?? null;
        },
        set(this: HTMLMediaElement, value: MediaError) {
            mediaErrors.set(this, value);
        },
    },
    // Reaching the end pauses, as a browser does when the element doesn't loop.
    ended: {
        configurable: true,
        get(this: HTMLMediaElement) {
            return mediaState(this).ended;
        },
        set(this: HTMLMediaElement, value: boolean) {
            const state = mediaState(this);
            state.ended = value;
            if (!value) return;
            const wasPlaying = !state.paused;
            state.paused = true;
            if (wasPlaying) this.dispatchEvent(new Event("pause"));
            this.dispatchEvent(new Event("ended"));
        },
    },
    play: {
        configurable: true,
        value(this: HTMLMediaElement) {
            const state = mediaState(this);
            if (state.paused) {
                state.paused = false;
                state.ended = false;
                this.dispatchEvent(new Event("play"));
                this.dispatchEvent(new Event("playing"));
            }
            return Promise.resolve();
        },
    },
    pause: {
        configurable: true,
        value(this: HTMLMediaElement) {
            const state = mediaState(this);
            if (!state.paused) {
                state.paused = true;
                this.dispatchEvent(new Event("pause"));
            }
        },
    },
    load: {
        configurable: true,
        value(this: HTMLMediaElement) {
            const state = mediaState(this);
            Object.assign(state, { currentTime: 0, duration: Number.NaN, paused: true, ended: false });
            this.dispatchEvent(new Event("emptied"));
        },
    },
});

// jsdom answers `""` to every `canPlayType`. This stands for a browser that plays H.264 and AAC in MP4 or QuickTime,
// and nothing else, which is what most tests' videos are.
const DIRECT_TYPES = /^video\/(mp4|quicktime); codecs="avc1\.[0-9a-f]+(,mp4a\.40\.2)?"$/;
Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
    configurable: true,
    value: (type: string) => (DIRECT_TYPES.test(type) ? "probably" : ""),
});
