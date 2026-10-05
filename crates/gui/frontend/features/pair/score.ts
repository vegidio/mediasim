/** Where a score falls, from least to most similar. */
export type Band = "different" | "related" | "similar" | "near-identical";

type BandInfo = {
    band: Band;
    /** What the score panel calls a score in this band. */
    name: string;
    /** The band's label under the bar. */
    label: string;
    /** The band's share of the bar, in percentage points; the shares add up to 100. */
    share: number;
};

/** Every band, in order along the bar. */
export const BANDS: readonly BandInfo[] = [
    { band: "different", name: "Different", label: "Different", share: 60 },
    { band: "related", name: "Related", label: "Related", share: 20 },
    { band: "similar", name: "Similar", label: "Similar", share: 10 },
    { band: "near-identical", name: "Near identical", label: "Near-identical", share: 10 },
];

/**
 * A similarity from 0 to 1 as the nearest whole percentage, a half rounding up. The epsilon keeps a half such as
 * `0.285 * 100 = 28.4999…` from being rounded down by floating-point error; no real score sits that close below a half,
 * so it never rounds anything else up.
 */
export const percent = (similarity: number) => Math.min(100, Math.max(0, Math.round(similarity * 100 + 1e-9)));

/** The band of a whole percentage, as {@link percent} gives it, so the number shown and its band always agree. */
export const band = (percent: number): BandInfo => {
    let start = 0;
    for (const info of BANDS) {
        start += info.share;
        if (percent < start) return info;
    }

    return BANDS[BANDS.length - 1] as BandInfo;
};

/** What the score panel calls a whole percentage: its band's name, or "Identical" for 100%. */
export const scoreName = (percent: number) => (percent === 100 ? "Identical" : band(percent).name);
