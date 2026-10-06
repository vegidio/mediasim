import { Trash2Icon } from "lucide-react";
import type { Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { formatSize } from "@/lib/format";
import { DetailValue } from "./DetailValue";
import { type Details, detailRows } from "./details";
import { MarkButton } from "./MarkButton";
import { MarkWash } from "./MarkWash";
import { Picture } from "./Picture";

type MediaPaneProps = {
    slot: Slot;
    file: MediaFile;
    details: Details;
    /** The other file's details, which decide this pane's badges. */
    other: Details;
    /** Whether the file is marked for deletion. */
    marked: boolean;
    onToggleMark: () => void;
    /** Whether the file has been moved to the Trash, which leaves a placeholder in its place. */
    trashed?: boolean;
};

/** A file moved to the Trash: a dashed placeholder with its name and the space freed, and nothing to act on. */
const GonePane = ({ slot, file }: { slot: Slot; file: MediaFile }) => (
    <article
        aria-label={`File ${slot.toUpperCase()}`}
        className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-[#3F3F46] border-dashed bg-[rgba(17,17,19,.6)] p-6 text-center"
    >
        <span className="flex size-12 items-center justify-center rounded-full border border-[#27272A] bg-[#18181B]">
            <Trash2Icon aria-hidden="true" className="size-[22px] text-[#A1A1AA]" />
        </span>
        <span title={file.name} className="max-w-full truncate font-mono text-[#E4E4E7] text-[13px]">
            {file.name}
        </span>
        <span className="text-[#A1A1AA] text-[13px]">Moved to Trash · {formatSize(file.size)} freed</span>
    </article>
);

/**
 * One file of the pair: its badge, name and mark button, its picture, washed red while marked, and its details with the
 * badges it earns. Once moved to the Trash, a placeholder in its place.
 */
export const MediaPane = ({ slot, file, details, other, marked, onToggleMark, trashed = false }: MediaPaneProps) => {
    const badge = slot.toUpperCase();

    if (trashed) return <GonePane slot={slot} file={file} />;

    return (
        <article
            aria-label={`File ${badge}`}
            // No background of its own, so the picture sits on the main area's dotted background; only the bars are cards.
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-border"
        >
            <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-border border-b bg-card px-4">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary font-semibold text-xs">
                    {badge}
                </span>
                {/* Grows and shortens first, so a long name gives way before the button does. */}
                <span title={file.name} className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {file.name}
                </span>
                <MarkButton slot={slot} marked={marked} onToggle={onToggleMark} variant="pane" />
            </div>

            <div className="relative min-h-0 flex-1">
                {/* Keyed so another file starts loading afresh rather than showing as loaded. */}
                <Picture
                    key={file.identity}
                    file={file}
                    className="absolute inset-0"
                    // Over the picture alone, not the dotted space beside it.
                    overlay={
                        marked && (
                            <MarkWash>
                                {/* The button already states the mark. */}
                                <span
                                    aria-hidden="true"
                                    className="absolute top-3 right-3 flex h-[22px] items-center gap-1 rounded-full bg-[#DC2626] px-2 font-semibold text-[11px] text-white"
                                >
                                    <Trash2Icon className="size-[11px]" />
                                    Delete
                                </span>
                            </MarkWash>
                        )
                    }
                />
            </div>

            <dl className="shrink-0 border-border border-t bg-card px-4 py-1">
                {detailRows(file.type, details, other).map(({ key, ...row }) => (
                    <div
                        key={key}
                        className="grid grid-cols-[120px_1fr] items-center gap-3 border-border-subtle border-b py-2.5 last:border-b-0"
                    >
                        <dt className="text-[13px] text-muted-foreground">{key}</dt>
                        <dd className="flex min-w-0 items-center gap-2">
                            <DetailValue {...row} />
                        </dd>
                    </div>
                ))}
            </dl>
        </article>
    );
};
