import type { ScanProgress } from "@/stores/scan";

/** Where the scan's phase is: running, or finished. */
export type PhaseState = "active" | "done";

/** The phase row's mark and status. */
export type Phase = { state: PhaseState; status: string };

/** The grouping phase, as 6a shows it: "done / total" files while it runs, and "Done" once every file is grouped. */
export const groupingPhase = ({ done, total }: Pick<ScanProgress, "done" | "total">): Phase =>
    done === total ? { state: "done", status: "Done" } : { state: "active", status: `${done} / ${total}` };
