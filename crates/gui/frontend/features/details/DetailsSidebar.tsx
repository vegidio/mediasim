import { type ReactNode, useState } from "react";
import { ExternalLinkIcon, FolderIcon } from "lucide-react";
import { DetailPlaceholder } from "@/components/DetailPlaceholder";
import type { MediaType } from "@/ipc/formats";
import { openMedia, revealMedia } from "@/ipc/open";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { type DetailsRow, detailsSections, type FileDetails } from "./rows";

/** One of the chips above the sections: outlined, unless `className` styles it otherwise. */
export const Chip = ({ children, className }: { children: ReactNode; className?: string }) => (
    <span
        className={cn(
            "flex h-[22px] items-center rounded-full border border-border-strong px-2 font-medium text-text-label text-[11px]",
            className,
        )}
    >
        {children}
    </span>
);

/** What the kind chip reads for a file of kind `type`. */
export const kindLabel = (type: MediaType) => (type === "video" ? "Video" : "Image");

/** One row's value, cut short with the whole of it in a tooltip, or a placeholder while it is read. */
const Value = ({ value, mono }: Omit<DetailsRow, "key">) =>
    value ? (
        <span title={value} className={cn("block truncate", mono && "font-mono text-xs")}>
            {value}
        </span>
    ) : (
        <DetailPlaceholder className="ml-auto block" />
    );

export const ACTION =
    "flex cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-transparent font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary";

/** Which of the system actions last failed. */
type Failure = "open" | "reveal";

const FAILURE_MESSAGES: Record<Failure, string> = {
    open: "Couldn't open this file.",
    reveal: "Couldn't show this file in its folder.",
};

type DetailsSidebarProps = {
    file: MediaFile;
    details: FileDetails;
    /** The chips above the sections, starting with the kind chip. */
    chips: ReactNode;
    /** The button below "Open in app" and "Show in folder". */
    action: ReactNode;
};

/**
 * The caller's chips, the file's details by section, and the actions on it, with the caller's button last. A failed
 * action's message stays until an action is tried again; the dialog keys this by path, so it is also gone once another
 * file is shown.
 */
export const DetailsSidebar = ({ file, details, chips, action }: DetailsSidebarProps) => {
    const { type } = file;
    const [failure, setFailure] = useState<Failure>();

    const attempt = (which: Failure) => {
        setFailure(undefined);
        const run = which === "open" ? openMedia : revealMedia;
        run(file.identity).catch(() => setFailure(which));
    };

    return (
        <aside aria-label="File details" className="flex min-h-0 w-[340px] shrink-0 flex-col border-border border-l">
            <div className="flex flex-wrap gap-1.5 border-border-subtle border-b px-5 pt-4 pb-3">{chips}</div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-2">
                {detailsSections(type, details).map(({ title, rows }) => (
                    <section key={title} aria-label={title} className="flex flex-col pt-3.5 pb-1">
                        <h3 className="pb-1.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-[0.06em]">
                            {title}
                        </h3>
                        <dl className="m-0 grid grid-cols-[104px_minmax(0,1fr)] text-[13px]">
                            {rows.map(({ key, value, mono }) => (
                                <div key={key} className="contents">
                                    <dt className="py-[5px] text-muted-foreground">{key}</dt>
                                    <dd className="m-0 min-w-0 py-[5px] text-right text-foreground">
                                        <Value {...(value && { value })} {...(mono && { mono })} />
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>

            <div className="box-border flex min-h-[116px] shrink-0 flex-col justify-center gap-2.5 border-border-subtle border-t px-5 py-[13px]">
                {failure && (
                    <p role="alert" className="m-0 text-danger-soft text-xs">
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
                {action}
            </div>
        </aside>
    );
};
