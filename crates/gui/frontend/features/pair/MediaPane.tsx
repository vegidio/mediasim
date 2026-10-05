import type { Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { DetailValue } from "./DetailValue";
import { type Details, detailRows } from "./details";
import { Picture } from "./Picture";

type MediaPaneProps = {
    slot: Slot;
    file: MediaFile;
    details: Details;
    /** The other file's details, which decide this pane's badges. */
    other: Details;
};

/** One file of the pair: its badge and name, its picture, and its details with the badges it earns. */
export const MediaPane = ({ slot, file, details, other }: MediaPaneProps) => {
    const badge = slot.toUpperCase();

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
                <span title={file.name} className="truncate font-mono text-[13px]">
                    {file.name}
                </span>
            </div>

            {/* Keyed so another file starts loading afresh rather than showing as loaded. */}
            <Picture key={file.identity} file={file} className="min-h-0 flex-1" />

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
