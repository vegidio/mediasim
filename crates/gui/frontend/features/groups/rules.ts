import { arrayMove } from "@dnd-kit/sortable";
import type { GroupFile } from "@/ipc/scan";
import { fileName } from "./format";

/** A rule that picks a group's best file. */
export type RuleId = "duration" | "resolution" | "size" | "created" | "name";

/** A rule and whether it is applied. */
export type Rule = { id: RuleId; on: boolean };

/** The rules a group's best file is picked by, in 9b's order and with 9b's toggles. */
export const DEFAULT_RULES: readonly Rule[] = [
    { id: "duration", on: true },
    { id: "resolution", on: true },
    { id: "size", on: true },
    { id: "created", on: false },
    { id: "name", on: true },
];

/** How a rule reads in the rule list: its label, its hint, and whether it applies to videos only. */
export type RuleInfo = { label: string; hint: string; videoOnly?: boolean };

/** Every rule's wording, the one place 9b's and 10b's lists take it from. */
export const RULE_INFO: Record<RuleId, RuleInfo> = {
    duration: { label: "Longest video length", hint: "Prefer the file with the longest duration", videoOnly: true },
    resolution: { label: "Highest resolution", hint: "Pixel count for images, frame size for videos" },
    size: { label: "Largest file size", hint: "Usually the least compressed copy" },
    created: { label: "Oldest creation date", hint: "The first copy is usually the original" },
    name: { label: "Cleanest file name", hint: "Avoids “copy”, “(1)” and “-edit” suffixes" },
};

const RULE_IDS = Object.keys(RULE_INFO) as RuleId[];

/** Whether `value` is a rule list: each of the five rules exactly once, with a boolean `on`, in any order. */
export const isRules = (value: unknown): value is Rule[] => {
    if (!Array.isArray(value) || value.length !== RULE_IDS.length) return false;

    const ids = new Set<unknown>();
    for (const rule of value) {
        if (typeof rule !== "object" || !rule) return false;
        const { id, on } = rule as Record<string, unknown>;
        if (!RULE_IDS.includes(id as RuleId) || typeof on !== "boolean") return false;
        ids.add(id);
    }

    return ids.size === RULE_IDS.length;
};

/** `rules` with the rule at `from` moved to `to`, the others shifting to make room. */
export const moveRule = (rules: readonly Rule[], from: number, to: number): Rule[] => arrayMove([...rules], from, to);

/** A rule that is on, as 10a's chips show it: its rank among the rules that are on, from 1, and its label. */
export type RankedRule = { id: RuleId; rank: number; label: string };

/** The rules of `rules` that are on, in order, each ranked among them and labelled from {@link RULE_INFO}. */
export const rankedRules = (rules: readonly Rule[]): RankedRule[] =>
    rules.filter(({ on }) => on).map(({ id }, index) => ({ id, rank: index + 1, label: RULE_INFO[id].label }));

/** The copy markers removed from the end of a stem, one at a time; each needs its separator, so "copy" alone isn't one. */
const MARKERS = [/\s?\(\d+\)$/i, /(\s-\s|[\s_-])copy(\s\d+)?$/i, /[\s_-]edit(ed)?$/i];

/** The number of copy markers, such as " (1)", " copy" or "-edit", at the end of `name`'s stem. */
export const copyMarkers = (name: string) => {
    const dot = name.lastIndexOf(".");
    let stem = dot > 0 ? name.slice(0, dot) : name;
    let count = 0;

    for (;;) {
        const marker = MARKERS.find((pattern) => pattern.test(stem));
        if (!marker) return count;
        stem = stem.replace(marker, "");
        count += 1;
    }
};

/** Each rule's key: the file with the largest one wins. */
const KEYS: Record<RuleId, (file: GroupFile) => number> = {
    // Whole seconds, as the badge shows, so a copy a few milliseconds longer doesn't beat a sharper original.
    duration: (file) => Math.floor(file.duration ?? 0),
    resolution: (file) => file.width * file.height,
    size: (file) => file.size,
    created: (file) => {
        const time = file.created ? Date.parse(file.created) : Number.NaN;
        return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : -time;
    },
    name: (file) => -copyMarkers(fileName(file.path)),
};

/**
 * The index of the best of `files`, which must not be empty: each rule that is on keeps the files with its best key, in
 * turn, until one file is left. The duration rule applies only when every file is a video, and the path that sorts
 * first breaks any tie left.
 */
export const bestIndex = (files: readonly GroupFile[], rules: readonly Rule[] = DEFAULT_RULES) => {
    const videos = files.every((file) => file.type === "video");
    let candidates = files.map((file, index) => ({ file, index }));

    for (const { id, on } of rules) {
        if (candidates.length <= 1) break;
        if (!on || (id === "duration" && !videos)) continue;

        const keys = candidates.map(({ file }) => KEYS[id](file));
        const best = Math.max(...keys);
        candidates = candidates.filter((_, i) => keys[i] === best);
    }

    return candidates.reduce((best, candidate) => (candidate.file.path < best.file.path ? candidate : best)).index;
};
