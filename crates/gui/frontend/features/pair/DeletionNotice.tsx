import { useEffect, useState } from "react";
import { CircleCheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePairResultStore } from "@/stores/pairResult";

/** The Dismiss button's id, which focus is sent to after a move, a deletion or a restore. */
export const DISMISS_ID = "deletion-notice-dismiss";

/** Move focus to the notice's Dismiss, once React has rendered the notice a move or a restore just set. */
export const focusDismiss = () => {
    requestAnimationFrame(() => document.getElementById(DISMISS_ID)?.focus());
};

/** How long a notice with no failure stays, in milliseconds, while nothing holds it open. */
export const HIDE_AFTER = 6000;

/** Whether `element` has focus a keyboard user can see, which is what holds the notice open; a click's doesn't. */
const isFocusVisible = (element: Element) => {
    try {
        return element.matches(":focus-visible");
    } catch {
        // An engine that can't tell keeps the notice, rather than hiding it from someone reading it.
        return true;
    }
};

type DeletionNoticeProps = {
    className?: string;
};

/**
 * The result of the last move to the Trash, permanent deletion or restore: how many files moved or were deleted and the
 * space freed, or how many were restored, then each file it failed for with the reason. A move's notice offers Undo
 * while any file it moved is still in the Trash; a deletion's never does. A notice with no failure hides after
 * {@link HIDE_AFTER}, unless the pointer is over it or keyboard focus is in it; one reporting a failure stays until
 * dismissed, so the reason is never lost before it is read. The status region is always there, so what appears in it
 * is announced.
 */
export const DeletionNotice = ({ className }: DeletionNoticeProps) => {
    const files = usePairResultStore((state) => state.files);
    const notice = usePairResultStore((state) => state.notice);
    const dismissNotice = usePairResultStore((state) => state.dismissNotice);
    const gone = usePairResultStore((state) => state.gone);
    const restoring = usePairResultStore((state) => state.deletion.status === "restoring");
    const restore = usePairResultStore((state) => state.restore);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);

    // A notice dismissed under the pointer unmounts without a leave, so each new one starts free of the last's hold.
    const [shown, setShown] = useState(notice);
    if (notice !== shown) {
        setShown(notice);
        setHovered(false);
        setFocused(false);
    }

    useEffect(() => {
        if (!notice || notice.failed.length > 0 || hovered || focused) return;

        // Restarts in full after each hover or focus, and for each new notice.
        const timer = setTimeout(dismissNotice, HIDE_AFTER);
        return () => clearTimeout(timer);
    }, [notice, hovered, focused, dismissNotice]);

    const done = files && notice ? notice.done.map((slot) => files[slot]) : [];
    // What Undo puts back: the files this move moved that are still in the Trash.
    const undoable = notice?.action === "trash" ? notice.done.filter((slot) => gone[slot] === "trash") : [];
    const failedVerb = { trash: "move", permanent: "delete", restore: "restore" }[notice?.action ?? "trash"];

    return (
        <div role="status" className={cn("w-max max-w-[min(640px,calc(100%-32px))]", className)}>
            {files && notice && (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only hold the notice open; nothing is activated.
                <div
                    onPointerEnter={() => setHovered(true)}
                    onPointerLeave={() => setHovered(false)}
                    onFocus={(event) => setFocused(isFocusVisible(event.target))}
                    onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
                    }}
                    className="flex items-start gap-3 rounded-xl border border-[#3F3F46] bg-[#18181B] py-2.5 pr-2.5 pl-3.5 shadow-[0_12px_32px_rgba(0,0,0,.5)]"
                >
                    {done.length > 0 ? (
                        <CircleCheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[#BEF264]" />
                    ) : (
                        <TriangleAlertIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[#F87171]" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1 text-sm">
                        {done.length > 0 &&
                            (notice.action !== "restore" ? (
                                <p className="whitespace-nowrap">
                                    <span className="font-semibold">{formatCount(done.length)}</span>{" "}
                                    {notice.action === "trash" ? "moved to Trash" : "deleted"}
                                    <span className="text-[#A1A1AA]"> · {formatSize(totalSize(done))} freed</span>
                                </p>
                            ) : (
                                <p className="whitespace-nowrap">
                                    <span className="font-semibold">{formatCount(done.length)}</span> restored
                                </p>
                            ))}
                        {notice.failed.map(({ slot, message }) => (
                            <p key={slot} className="break-words">
                                Couldn't {failedVerb} <span className="font-mono">{files[slot].name}</span>
                                <span className="text-[#A1A1AA]">: {message}</span>
                            </p>
                        ))}
                    </div>
                    {undoable.length > 0 && (
                        <Button
                            variant="outline"
                            aria-label={`Undo moving ${formatCount(undoable.length)} to Trash`}
                            disabled={restoring}
                            onClick={() => restore(undoable).then(focusDismiss)}
                            className="h-[30px] shrink-0 self-center rounded-[6px] border-[#3F3F46] bg-transparent px-3 font-medium text-[#FAFAFA] text-[13px] dark:border-[#3F3F46] dark:bg-transparent"
                        >
                            Undo
                        </Button>
                    )}
                    <Button
                        id={DISMISS_ID}
                        variant="ghost"
                        size="icon"
                        aria-label="Dismiss"
                        onClick={dismissNotice}
                        className="size-7 shrink-0 text-[#A1A1AA] [&_svg:not([class*='size-'])]:size-3.5"
                    >
                        <XIcon aria-hidden="true" />
                    </Button>
                </div>
            )}
        </div>
    );
};
