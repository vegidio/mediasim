import { SLOTS, type Slot } from "@/features/start/routePairDrop";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import type { GoneKind } from "@/stores/pairResult";
import { DetailValue } from "./DetailValue";
import { type Details, detailRows } from "./details";
import { SlotBadge } from "./SlotBadge";

type DetailsTableProps = {
    files: Record<Slot, MediaFile>;
    details: Record<Slot, Details>;
    /** How each file that has left went; their rows are faded and struck through. */
    gone?: Partial<Record<Slot, GoneKind>>;
};

const HEADER = "px-4 pt-3 pb-1.5 text-left font-normal text-[11px] text-muted-foreground uppercase tracking-[0.06em]";

/**
 * Both files' details, one row per file and one column per detail, with the values and badges each file's pane would
 * show. Only a pair of the same media type is compared, so A's type gives both rows' columns.
 */
export const DetailsTable = ({ files, details, gone }: DetailsTableProps) => {
    const rows = {
        a: detailRows(files.a.type, details.a, details.b),
        b: detailRows(files.b.type, details.b, details.a),
    };

    return (
        <table className="w-full shrink-0 table-fixed border-border border-t bg-card">
            <colgroup>
                <col className="w-[60px]" />
                {rows.a.map(({ key }) => (
                    <col key={key} />
                ))}
            </colgroup>
            <thead>
                <tr>
                    <th scope="col" className={HEADER}>
                        File
                    </th>
                    {rows.a.map(({ key }) => (
                        <th key={key} scope="col" className={HEADER}>
                            {key}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {SLOTS.map((slot) => (
                    <tr
                        key={slot}
                        className={cn("border-border-subtle border-t", gone?.[slot] && "line-through opacity-40")}
                    >
                        <th scope="row" className="px-4 py-2 text-left">
                            <SlotBadge slot={slot} />
                        </th>
                        {rows[slot].map(({ key, ...row }) => (
                            <td key={key} className="px-4 py-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <DetailValue {...row} />
                                </div>
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
};
