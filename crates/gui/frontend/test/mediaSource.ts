import { afterEach } from "vitest";

/** A stub `TimeRanges` over sorted, disjoint `[start, end]` pairs. */
const timeRanges = (ranges: [number, number][]): TimeRanges => ({
    length: ranges.length,
    start: (index) => ranges[index]?.[0] ?? Number.NaN,
    end: (index) => ranges[index]?.[1] ?? Number.NaN,
});

/**
 * jsdom has no Media Source Extensions. In this stub a media segment says how long it is: one whose bytes start with a
 * float64 covers that many seconds, placed right after the media appended before it, from `timestampOffset` on; a
 * shorter one, such as an init segment, covers none. Appends and removals finish on the next microtask, as a browser's
 * do asynchronously.
 */
export class StubSourceBuffer extends EventTarget {
    updating = false;
    #ranges: [number, number][] = [];
    #offset = 0;
    /** Where the next media segment starts. */
    #cursor = 0;
    readonly appended: ArrayBuffer[] = [];
    /** Set by a test to make the next append fail with `QuotaExceededError`. */
    quotaExceeded = false;

    constructor(readonly mime: string) {
        super();
    }

    get buffered() {
        return timeRanges(this.#ranges);
    }

    get timestampOffset() {
        return this.#offset;
    }

    set timestampOffset(offset: number) {
        this.#offset = offset;
        this.#cursor = offset;
    }

    appendBuffer(data: ArrayBuffer) {
        if (this.updating) throw new DOMException("still updating", "InvalidStateError");
        if (this.quotaExceeded) {
            this.quotaExceeded = false;
            throw new DOMException("the buffer is full", "QuotaExceededError");
        }
        this.appended.push(data);
        if (data.byteLength >= 8) {
            const seconds = new DataView(data).getFloat64(0);
            this.#add(this.#cursor, this.#cursor + seconds);
            this.#cursor += seconds;
        }
        this.#update();
    }

    remove(start: number, end: number) {
        this.#ranges = this.#ranges.flatMap(([from, to]): [number, number][] => {
            const kept: [number, number][] = [];
            if (from < start) kept.push([from, Math.min(to, start)]);
            if (to > end) kept.push([Math.max(from, end), to]);
            return kept;
        });
        this.#update();
    }

    abort() {
        this.updating = false;
    }

    #add(start: number, end: number) {
        const ranges = [...this.#ranges, [start, end] as [number, number]].sort((x, y) => x[0] - y[0]);
        this.#ranges = ranges.reduce<[number, number][]>((merged, range) => {
            const last = merged.at(-1);
            if (last && range[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], range[1]);
            else merged.push([...range]);
            return merged;
        }, []);
    }

    #update() {
        this.updating = true;
        queueMicrotask(() => {
            this.updating = false;
            this.dispatchEvent(new Event("updateend"));
        });
    }
}

/** The element each object URL is attached to, found when the stub opens. */
const objectUrls = new Map<string, StubMediaSource>();
let nextObjectUrl = 0;

export class StubMediaSource extends EventTarget {
    readyState: "closed" | "open" | "ended" = "closed";
    duration = Number.NaN;
    readonly sourceBuffers: StubSourceBuffer[] = [];
    /** The element this was attached to, once it opened. */
    element?: HTMLMediaElement;
    /** The argument of each `endOfStream` call. */
    readonly endings: (string | undefined)[] = [];

    static isTypeSupported(type: string) {
        return /^video\/mp4; codecs="avc1\.[0-9a-f]+(,mp4a\.40\.2)?"$/.test(type);
    }

    addSourceBuffer(mime: string) {
        const buffer = new StubSourceBuffer(mime);
        this.sourceBuffers.push(buffer);
        return buffer;
    }

    endOfStream(error?: string) {
        if (this.readyState !== "open") throw new DOMException("not open", "InvalidStateError");
        this.endings.push(error);
        this.readyState = "ended";
        // A browser fails the element it feeds on an error, which is how a player learns of it.
        if (error) this.element?.dispatchEvent(new Event("error"));
    }
}

/** The stub media sources created so far, in order, for tests to drive and inspect. */
export const mediaSources: StubMediaSource[] = [];

globalThis.MediaSource = class extends StubMediaSource {
    constructor() {
        super();
        mediaSources.push(this);
    }
} as unknown as typeof MediaSource;

URL.createObjectURL = (object: Blob | MediaSource) => {
    const url = `blob:stub/${nextObjectUrl++}`;
    if (object instanceof StubMediaSource) {
        objectUrls.set(url, object);
        // A browser opens the source once the element loads its URL, which is after the caller has set it.
        setTimeout(() => {
            const element = document.querySelector<HTMLMediaElement>(`[src="${url}"]`);
            if (!element || object.readyState !== "closed") return;
            object.element = element;
            object.readyState = "open";
            object.dispatchEvent(new Event("sourceopen"));
        });
    }
    return url;
};

/** The object URLs revoked so far. */
export const revokedUrls: string[] = [];

URL.revokeObjectURL = (url: string) => {
    revokedUrls.push(url);
    objectUrls.delete(url);
};

afterEach(() => {
    mediaSources.length = 0;
    revokedUrls.length = 0;
});
