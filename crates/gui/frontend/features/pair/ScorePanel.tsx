import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PairFailure } from "@/ipc/pair";
import { cn } from "@/lib/utils";
import type { Comparison } from "@/stores/pairResult";
import { BANDS, type Band, band, percent, scoreName } from "./score";

/** The last component of a path, on any platform. */
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * The bar's band labels, each spanning its band's share, with `current` emphasized and the rest `dimmed` or muted. A
 * mark at the start of every band but the first shows where it begins.
 */
const Legend = ({ current, dimmed = false }: { current?: Band; dimmed?: boolean }) => (
    <ul className="mt-2.5 grid grid-cols-[60fr_20fr_10fr_10fr] text-[12px]">
        {BANDS.map(({ band, label }, index) => (
            <li
                key={band}
                data-testid="band-label"
                aria-current={band === current ? "true" : undefined}
                className={cn(
                    "truncate",
                    index > 0 && "border-l pl-1.5",
                    index > 0 && (dimmed ? "border-border" : "border-border-strong"),
                    band === current ? "text-foreground" : dimmed ? "text-text-faint" : "text-muted-foreground",
                )}
            >
                {label}
            </li>
        ))}
    </ul>
);

const Comparing = () => (
    <>
        <div
            aria-hidden="true"
            className="h-16 w-[84px] shrink-0 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none"
        />
        <div role="status" className="flex w-[200px] shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            Comparing…
        </div>
        <div className="min-w-0 flex-1">
            <div className="relative h-2 overflow-hidden rounded-full bg-border">
                <div className="absolute inset-y-0 left-0 w-1/3 animate-slide rounded-full bg-border-strong motion-reduce:animate-none" />
            </div>
            <Legend dimmed />
        </div>
    </>
);

const Done = ({ similarity }: { similarity: number }) => {
    const score = percent(similarity);
    const { band: current } = band(score);
    const name = scoreName(score);

    return (
        <>
            <div className="shrink-0 font-semibold text-[64px] text-primary leading-none tracking-[-0.03em] tabular-nums">
                {score}
                <span className="text-[28px]">%</span>
            </div>
            <div className="w-[200px] shrink-0 font-semibold text-[18px]">{name}</div>
            <div className="min-w-0 flex-1">
                {/* Decorative: the score and its band are read as text. */}
                <div aria-hidden="true" className="relative h-2 rounded-full bg-border">
                    <div
                        data-testid="score-fill"
                        className="absolute inset-y-0 left-0 rounded-full bg-primary"
                        style={{ width: `${score}%` }}
                    />
                    <div
                        data-testid="score-marker"
                        className="absolute top-1/2 h-[18px] w-1 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-foreground"
                        style={{ left: `${score}%` }}
                    />
                </div>
                <Legend current={current} />
            </div>
        </>
    );
};

/** What went wrong, naming the file it concerns when there is one. */
const Reason = ({ error }: { error: PairFailure }) => {
    switch (error.kind) {
        case "load":
            return (
                <>
                    <p>
                        Couldn't load <span className="font-mono">{fileName(error.path)}</span>
                    </p>
                    <p className="select-text break-all text-muted-foreground text-xs">{error.message}</p>
                </>
            );
        case "mismatch":
            return <p>An image can't be compared with a video.</p>;
        case "task":
            return <p className="select-text">{error.message}</p>;
        case "cancelled":
            return <p>The comparison was cancelled.</p>;
    }
};

const Failed = ({ error, onRetry }: { error: PairFailure; onRetry?: () => void }) => (
    <div role="alert" className="flex min-w-0 flex-1 items-center gap-4">
        <TriangleAlertIcon aria-hidden="true" className="size-6 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <p className="font-semibold text-[18px]">Couldn't compare these files</p>
            <Reason error={error} />
        </div>
        {onRetry && (
            <Button variant="outline" onClick={onRetry} className="h-9 px-3.5">
                Try again
            </Button>
        )}
    </div>
);

type ScorePanelProps = {
    comparison: Comparison;
    /** Called by "Try again", in the failed state. */
    onRetry: () => void;
    /** Whether "Try again" is offered; not once a file of the pair is gone, since it could only fail. */
    canRetry?: boolean;
};

/** The similarity of the pair: a placeholder while comparing, then the score and its band, or what went wrong. */
export const ScorePanel = ({ comparison, onRetry, canRetry = true }: ScorePanelProps) => (
    <section
        aria-label="Similarity result"
        aria-busy={comparison.status === "comparing"}
        className="flex shrink-0 items-center gap-10 rounded-[14px] border border-border bg-card px-7 py-[22px]"
    >
        {comparison.status === "comparing" && <Comparing />}
        {comparison.status === "done" && <Done similarity={comparison.similarity} />}
        {comparison.status === "failed" && <Failed error={comparison.error} {...(canRetry && { onRetry })} />}
    </section>
);
