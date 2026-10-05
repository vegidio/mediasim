import type { DetailRow } from "./details";

/** One detail's value, or a placeholder while it is read, followed by the badge it earns, if any. */
export const DetailValue = ({ value, badge }: Omit<DetailRow, "key">) => (
    <>
        {value === undefined ? (
            <span
                data-testid="detail-placeholder"
                className="h-3 w-24 animate-pulse rounded bg-secondary motion-reduce:animate-none"
            >
                <span className="sr-only">Loading</span>
            </span>
        ) : (
            <span title={value} className="truncate font-mono text-xs">
                {value}
            </span>
        )}
        {badge && (
            <span className="shrink-0 rounded-full bg-[rgba(190,242,100,0.12)] px-2 py-0.5 text-[11px] text-primary">
                {badge}
            </span>
        )}
    </>
);
