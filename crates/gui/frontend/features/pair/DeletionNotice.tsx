import { useEffect, useState } from "react";
import { CircleCheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePairResultStore } from "@/stores/pairResult";

/** The Dismiss button's id, which the confirmation dialog sends focus to after a move. */
export const DISMISS_ID = "deletion-notice-dismiss";

/** How long a notice of files all moved stays, in milliseconds, while nothing holds it open. */
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
 * The result of the last move to the Trash: how many files moved and the space freed, then each file that couldn't be
 * moved with the reason. A notice of files all moved hides after {@link HIDE_AFTER}, unless the pointer is over it or
 * keyboard focus is in it; one reporting a failure stays until dismissed, so the reason is never lost before it is
 * read. The status region is always there, so what appears in it is announced.
 */
export const DeletionNotice = ({ className }: DeletionNoticeProps) => {
    const files = usePairResultStore((state) => state.files);
    const notice = usePairResultStore((state) => state.notice);
    const dismissNotice = usePairResultStore((state) => state.dismissNotice);
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

    const moved = files && notice ? notice.moved.map((slot) => files[slot]) : [];
    const freed = moved.reduce((total, file) => total + file.size, 0);

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
                    {moved.length > 0 ? (
                        <CircleCheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[#BEF264]" />
                    ) : (
                        <TriangleAlertIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-[#F87171]" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1 text-sm">
                        {moved.length > 0 && (
                            <p className="whitespace-nowrap">
                                <span className="font-semibold">
                                    {moved.length === 1 ? "1 file" : `${moved.length} files`}
                                </span>{" "}
                                moved to Trash<span className="text-[#A1A1AA]"> · {formatSize(freed)} freed</span>
                            </p>
                        )}
                        {notice.failed.map(({ slot, message }) => (
                            <p key={slot} className="break-words">
                                Couldn't move <span className="font-mono">{files[slot].name}</span>
                                <span className="text-[#A1A1AA]">: {message}</span>
                            </p>
                        ))}
                    </div>
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
