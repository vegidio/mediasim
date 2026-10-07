import { type Ref, useRef, useState } from "react";
import { FilmIcon, FolderIcon, ImageIcon, LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    AddToSetMenu,
    anchorFor,
    type Point,
    pickFilesIntoSet,
    pickFoldersIntoSet,
} from "@/features/start/AddToSetMenu";
import { formatCount, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type SourceRow, useStartStore } from "@/stores/start";

/** What a row says under its name: a status alone, or a location and what the source holds. */
const detailsOf = (row: SourceRow): { location?: string; summary: string } => {
    if (row.pending) return { summary: "Counting…" };
    if (row.unreadable) return { summary: "Can't read this folder" };
    if (row.kind === "folder") {
        return { location: row.location, summary: ` · ${formatCount(row.count)} · ${formatSize(row.size)}` };
    }
    return { location: row.location, summary: ` · ${formatSize(row.size)}` };
};

/** The details line. A long location is what gets cut, so the count and size always stay readable. */
const Details = ({ row }: { row: SourceRow }) => {
    const { location, summary } = detailsOf(row);

    return (
        <span className="flex min-w-0 whitespace-pre font-mono text-muted-foreground text-xs">
            {location !== undefined && <span className="truncate">{location}</span>}
            <span className="shrink-0">{summary}</span>
        </span>
    );
};

const RowIcon = ({ row }: { row: SourceRow }) => {
    if (row.pending) return <LoaderCircleIcon aria-hidden="true" className="animate-spin" />;
    if (row.kind === "folder") return <FolderIcon aria-hidden="true" />;
    if (row.kind === "video") return <FilmIcon aria-hidden="true" />;
    return <ImageIcon aria-hidden="true" />;
};

/** One source: its icon, name and details, and a button that removes it. */
const SetRow = ({ row }: { row: SourceRow }) => {
    const remove = useStartStore((state) => state.remove);

    return (
        <li className="flex items-center gap-3 border-border-subtle border-b py-2.5 pr-2.5 pl-3.5">
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-primary [&_svg]:size-[18px]">
                <RowIcon row={row} />
            </span>
            <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="truncate font-medium text-sm">{row.name}</span>
                <Details row={row} />
            </span>
            <Button
                variant="ghost"
                aria-label={`Remove ${row.name}`}
                onClick={() => remove(row.path)}
                className="size-[30px] p-0 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
            >
                <XIcon aria-hidden="true" />
            </Button>
        </li>
    );
};

type SetListProps = {
    /** The list's box, which is the set card's drop target while the set has sources. */
    ref?: Ref<HTMLDivElement>;
    /** Whether something is being dragged over the box. */
    highlighted?: boolean;
};

/** The set's sources, in the order they were added, above a pinned row that opens the "Add to set" menu. */
export const SetList = ({ ref, highlighted = false }: SetListProps) => {
    const sources = useStartStore((state) => state.sources);
    const addMoreRef = useRef<HTMLButtonElement>(null);
    const [menuAnchor, setMenuAnchor] = useState<Point>();

    return (
        <div
            ref={ref}
            className={cn(
                "flex h-[210px] shrink-0 flex-col overflow-hidden rounded-[10px] border-[1.5px] border-border-strong bg-surface-sunken transition-colors",
                highlighted && "border-border-hover bg-card",
            )}
        >
            <ul aria-label="Selected sources" className="min-h-0 flex-1 overflow-y-auto">
                {sources.map((row) => (
                    <SetRow key={row.path} row={row} />
                ))}
            </ul>
            <div className="relative shrink-0">
                <button
                    ref={addMoreRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuAnchor !== undefined}
                    onClick={(event) => setMenuAnchor(anchorFor(event))}
                    className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 border-border border-t border-dashed text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-foreground [&_svg]:size-3.5"
                >
                    <PlusIcon aria-hidden="true" />
                    <span>Drop or click to add more files or folders</span>
                </button>
                <AddToSetMenu
                    {...(menuAnchor && { anchor: menuAnchor })}
                    onClose={() => setMenuAnchor(undefined)}
                    returnFocusTo={addMoreRef}
                    onPickFiles={pickFilesIntoSet}
                    onPickFolders={pickFoldersIntoSet}
                />
            </div>
        </div>
    );
};
