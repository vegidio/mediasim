import type { ReactNode } from "react";

/**
 * The red wash over a marked file's picture, filling the picture's own rectangle. Click-through, so a player or the
 * slider under it still takes presses.
 */
export const MarkWash = ({ children }: { children?: ReactNode }) => (
    <div
        data-testid="mark-wash"
        className="pointer-events-none absolute inset-0 bg-[rgba(69,10,10,.62)] shadow-[inset_0_0_0_2px_#EF4444]"
    >
        {children}
    </div>
);
