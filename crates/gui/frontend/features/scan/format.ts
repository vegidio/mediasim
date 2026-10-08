import { formatCount } from "@/lib/format";
import type { GalleryFilter } from "@/stores/gallery";

/**
 * The scan's estimate of the time left, `etaSeconds`, as the scan screen reads it: "Estimating time left" before there
 * is one, "Almost done" once it is zero, and otherwise "About …" in seconds, minutes, or hours and minutes. Seconds and
 * minutes are rounded up, so it never reads 0.
 */
export const formatTimeLeft = (etaSeconds?: number) => {
    if (etaSeconds === undefined) return "Estimating time left";
    if (etaSeconds <= 0) return "Almost done";

    const seconds = Math.ceil(etaSeconds);
    if (seconds < 60) return `About ${seconds} s left`;

    const minutes = Math.ceil(etaSeconds / 60);
    if (minutes < 60) return `About ${minutes} min left`;

    return `About ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};

/** Which kinds a scan compares, as its details line names them. */
export const formatKinds = (kinds: GalleryFilter) =>
    kinds === "both" ? "images and videos" : kinds === "videos" ? "videos" : "images";

/** "N files couldn't be read", or "1 file couldn't be read" for one. */
export const formatUnreadable = (count: number) => `${formatCount(count)} couldn't be read`;

/** `done` of `total` as a whole percentage, rounded down, so it reads 100 only when every file is done. */
export const percentDone = (done: number, total: number) => (total === 0 ? 0 : Math.floor((done / total) * 100));
