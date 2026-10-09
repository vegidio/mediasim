import type { MediaInfo } from "@/ipc/pair";

/** What a detail reads when the file doesn't say, or couldn't be read. */
export const UNKNOWN = "Unknown";

/** The sRGB profile almost every camera and phone embeds, whose full name would break a row. */
const SRGB = "sRGB IEC61966-2.1";

/** A colour profile, with sRGB's full name shortened. */
export const shortProfile = (profile: string) => (profile === SRGB ? "sRGB" : profile);

/** A width and height in pixels: `4032 × 3024`. */
export const formatResolution = ({ width, height }: Pick<MediaInfo, "width" | "height">) => `${width} × ${height}`;

/** What is known of a file's details: still being read, read with what `T` holds, or unreadable. */
export type Loadable<T> = { status: "loading" } | ({ status: "ready" } & T) | { status: "failed" };

/** What is known of a file's details, as the pair screen reads them. */
export type Details = Loadable<{ info: MediaInfo }>;

/**
 * The rows `specs` make of `details`, each starting from what `base` makes of its spec. A row's value is absent while
 * the details are loading, `Unknown` when they couldn't be read, and otherwise what `read` makes of the spec and them.
 */
export const rowsFor = <T, S, R extends { key: string; value?: string }>(
    specs: readonly S[],
    details: Loadable<T>,
    base: (spec: S) => R,
    read: (spec: S, ready: T) => Partial<R> & { value: string },
): R[] =>
    specs.map((spec) => {
        const row = base(spec);
        if (details.status === "loading") return row;
        if (details.status === "failed") return { ...row, value: UNKNOWN };
        return { ...row, ...read(spec, details) };
    });
