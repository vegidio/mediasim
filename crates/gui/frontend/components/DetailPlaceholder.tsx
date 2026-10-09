import { cn } from "@/lib/utils";

/** What a detail's value shows while it is read: a pulsing bar, named "Loading" for screen readers. */
export const DetailPlaceholder = ({ className }: { className?: string }) => (
    <span
        data-testid="detail-placeholder"
        className={cn("h-3 w-24 animate-pulse rounded bg-secondary motion-reduce:animate-none", className)}
    >
        <span className="sr-only">Loading</span>
    </span>
);
