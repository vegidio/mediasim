import { type ReactNode, useState } from "react";
import { CircleMinusIcon, CirclePlusIcon, ExternalLinkIcon, FolderIcon } from "lucide-react";
import { openMedia, revealMedia } from "@/ipc/open";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { type DetailsRow, detailsSections, type FileDetails } from "./rows";

const Chip = ({ children }: { children: ReactNode }) => (
    <span className="flex h-[22px] items-center rounded-full border border-[#3F3F46] px-2 font-medium text-[#E4E4E7] text-[11px]">
        {children}
    </span>
);

/** One row's value, cut short with the whole of it in a tooltip, or a placeholder while it is read. */
const Value = ({ value, mono }: Omit<DetailsRow, "key">) =>
    value === undefined ? (
        <span
            data-testid="detail-placeholder"
            className="ml-auto block h-3 w-24 animate-pulse rounded bg-secondary motion-reduce:animate-none"
        >
            <span className="sr-only">Loading</span>
        </span>
    ) : (
        <span title={value} className={cn("block truncate", mono && "font-mono text-xs")}>
            {value}
        </span>
    );

const ACTION =
    "flex cursor-pointer items-center justify-center rounded-lg border border-[#3F3F46] bg-transparent font-medium text-[#FAFAFA] outline-none hover:bg-[#18181B] focus-visible:ring-2 focus-visible:ring-primary";

/** Which of the system actions last failed. */
type Failure = "open" | "reveal";

const FAILURE_MESSAGES: Record<Failure, string> = {
    open: "Couldn't open this file.",
    reveal: "Couldn't show this file in its folder.",
};

type DetailsSidebarProps = {
    file: MediaFile;
    details: FileDetails;
    /** Whether the selected tab includes the file in the comparison. */
    included: boolean;
    /** Whether the file was removed from the comparison. */
    removed: boolean;
    /** Remove the file from the comparison, or add it back when it was removed. */
    onToggleRemoved: () => void;
};

/**
 * The file's kind, its details by section, and the actions on it. A failed action's message stays until an action is
 * tried again; the dialog keys this by path, so it is also gone once another file is shown.
 */
export const DetailsSidebar = ({ file, details, included, removed, onToggleRemoved }: DetailsSidebarProps) => {
    const { type } = file;
    const [failure, setFailure] = useState<Failure>();

    const attempt = (action: Failure) => {
        setFailure(undefined);
        const run = action === "open" ? openMedia : revealMedia;
        run(file.identity).catch(() => setFailure(action));
    };

    return (
        <aside aria-label="File details" className="flex min-h-0 w-[340px] shrink-0 flex-col border-[#27272A] border-l">
            <div className="flex flex-wrap gap-1.5 border-[#1F1F23] border-b px-5 pt-4 pb-3">
                <Chip>{type === "video" ? "Video" : "Image"}</Chip>
                {!included && <Chip>Not included</Chip>}
                {removed && <Chip>Removed</Chip>}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-2">
                {detailsSections(type, details).map(({ title, rows }) => (
                    <section key={title} aria-label={title} className="flex flex-col pt-3.5 pb-1">
                        <h3 className="pb-1.5 font-semibold text-[#A1A1AA] text-[11px] uppercase tracking-[0.06em]">
                            {title}
                        </h3>
                        <dl className="m-0 grid grid-cols-[104px_minmax(0,1fr)] text-[13px]">
                            {rows.map(({ key, value, mono }) => (
                                <div key={key} className="contents">
                                    <dt className="py-[5px] text-[#A1A1AA]">{key}</dt>
                                    <dd className="m-0 min-w-0 py-[5px] text-right text-[#FAFAFA]">
                                        <Value {...(value !== undefined && { value })} {...(mono && { mono })} />
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>

            <div className="box-border flex min-h-[116px] shrink-0 flex-col justify-center gap-2.5 border-[#1F1F23] border-t px-5 py-[13px]">
                {failure && (
                    <p role="alert" className="m-0 text-[#FCA5A5] text-xs">
                        {FAILURE_MESSAGES[failure]}
                    </p>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                    <button
                        type="button"
                        onClick={() => attempt("open")}
                        className={cn(ACTION, "h-9 gap-1.5 text-[13px]")}
                    >
                        <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                        Open in app
                    </button>
                    <button
                        type="button"
                        onClick={() => attempt("reveal")}
                        className={cn(ACTION, "h-9 gap-1.5 text-[13px]")}
                    >
                        <FolderIcon aria-hidden="true" className="size-3.5" />
                        Show in folder
                    </button>
                </div>
                <button type="button" onClick={onToggleRemoved} className={cn(ACTION, "h-[38px] gap-2 text-sm")}>
                    {removed ? (
                        <CirclePlusIcon aria-hidden="true" className="size-[15px]" />
                    ) : (
                        <CircleMinusIcon aria-hidden="true" className="size-[15px]" />
                    )}
                    {removed ? "Add back to comparison" : "Remove from comparison"}
                </button>
            </div>
        </aside>
    );
};
