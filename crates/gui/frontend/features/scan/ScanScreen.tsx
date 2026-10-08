import { useState } from "react";
import { MediaKindIcon } from "@/components/MediaKindIcon";
import { Button } from "@/components/ui/button";
import { focusCompare } from "@/features/gallery/GalleryToolbar";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { formatCount } from "@/lib/format";
import { useScanStore } from "@/stores/scan";
import { formatKinds, formatTimeLeft, formatUnreadable, percentDone } from "./format";

/** The longest edge, in pixels, the "Now processing" thumbnail is asked for: its 48×36 box on a 2× display. */
const THUMB_BOUND = 96;

const OUTLINE_BUTTON =
    "h-10 rounded-lg border-[#3F3F46] bg-transparent px-4 text-sm dark:border-[#3F3F46] dark:bg-transparent";

/** The heading: how many files are compared, and what, of which kinds, at which threshold. */
const Heading = () => {
    const heading = useScanStore((state) => state.heading);
    if (!heading) return null;

    const { count, set, kinds, threshold } = heading;

    return (
        <div className="flex flex-col gap-2">
            <h1 className="font-semibold text-[32px] tracking-[-0.02em]">Comparing {formatCount(count)}</h1>
            <p className="text-[#A1A1AA] text-[15px]">
                {set} · {formatKinds(kinds)} · match threshold {threshold}%
            </p>
        </div>
    );
};

/** The percentage, the time left and the progress bar. */
const Progress = () => {
    const { done, total, etaSeconds } = useScanStore((state) => state.progress);
    const percent = percentDone(done, total);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-4">
                <span className="font-semibold text-[56px] text-primary leading-none tracking-[-0.02em]">
                    {percent}
                    <span className="text-2xl">%</span>
                </span>
                <span className="text-[#A1A1AA] text-[13px]">{formatTimeLeft(etaSeconds)}</span>
            </div>
            <div
                role="progressbar"
                aria-label="Comparison progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-2 overflow-hidden rounded-full bg-[#27272A]"
            >
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
};

/** The grouping phase: a spinning mark while the scan runs, its name and hint, and the files done. */
const PhaseRow = () => {
    const { done, total, skipped } = useScanStore((state) => state.progress);
    const running = useScanStore((state) => state.status === "running");

    return (
        <div className="flex items-center gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center">
                {running && (
                    <span
                        data-testid="spinner"
                        aria-hidden="true"
                        className="size-6 animate-spin rounded-full border-2 border-[#3F3F46] border-t-primary [animation-duration:0.9s] motion-reduce:animate-none"
                    />
                )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium text-sm">Grouping similar files</span>
                <span className="text-[#A1A1AA] text-xs">
                    Matching media above the threshold{skipped > 0 && ` · ${formatUnreadable(skipped)}`}
                </span>
            </div>
            <span className="font-mono text-primary text-xs">
                {done} / {total}
            </span>
        </div>
    );
};

/** A file's 48×36 thumbnail, falling back to the icon of its kind, as gallery tiles do. */
const Thumbnail = ({ file }: { file: MediaFile }) => {
    const [failed, setFailed] = useState(false);

    return (
        <span className="relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#27272A] text-muted-foreground">
            {failed ? (
                <MediaKindIcon type={file.type} className="size-4" />
            ) : (
                // Decorative: the path beside it names the file.
                <img
                    alt=""
                    src={renditionUrl(file.identity, THUMB_BOUND)}
                    decoding="async"
                    onError={() => setFailed(true)}
                    className="size-full object-cover"
                />
            )}
        </span>
    );
};

/** The file the scan last reported it is processing, once it has reported one. */
const NowProcessing = () => {
    const current = useScanStore((state) => state.current);
    const file = useScanStore((state) => state.files.find((candidate) => candidate.path === state.current?.path));
    if (!current) return null;

    return (
        <div className="flex items-center gap-3 rounded-[10px] bg-[#18181B] p-3">
            {/* Every scanned file is one of `files`; keyed by file, so a thumbnail that failed doesn't hide the next. */}
            {file && <Thumbnail key={file.path} file={file} />}
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[#A1A1AA] text-xs">Now processing</span>
                <span title={current.display} className="truncate font-mono text-[13px]">
                    {current.display}
                </span>
            </div>
        </div>
    );
};

/** What replaces the progress card when the scan can't run at all. */
const Failure = () => {
    const leave = useScanStore((state) => state.leave);

    return (
        <div
            role="alert"
            className="flex flex-col items-start gap-4 rounded-[14px] border border-[#27272A] bg-[#111113] p-7"
        >
            <p className="font-medium text-[15px]">The comparison couldn't finish.</p>
            <Button
                variant="outline"
                onClick={() => {
                    leave();
                    focusCompare();
                }}
                className={OUTLINE_BUTTON}
            >
                Back to gallery
            </Button>
        </div>
    );
};

/**
 * The scan screen (6a): what is being compared, the progress of the scan, the file it is processing, and Cancel, which
 * returns to the gallery as it was.
 */
export const ScanScreen = () => {
    const failed = useScanStore((state) => state.status === "failed");
    const cancel = useScanStore((state) => state.cancel);

    return (
        <div className="m-auto flex w-full max-w-[680px] flex-col gap-8">
            <Heading />
            {failed ? (
                <Failure />
            ) : (
                <>
                    <section
                        aria-label="Comparison"
                        className="flex flex-col gap-6 rounded-[14px] border border-[#27272A] bg-[#111113] p-7"
                    >
                        <Progress />
                        <PhaseRow />
                        <NowProcessing />
                    </section>
                    <div className="flex items-center justify-between gap-6">
                        <p className="text-[#A1A1AA] text-[13px]">
                            Files are only read. Nothing is changed until you review the results.
                        </p>
                        <Button
                            variant="outline"
                            onClick={() => {
                                cancel();
                                focusCompare();
                            }}
                            className={OUTLINE_BUTTON}
                        >
                            Cancel
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
};
