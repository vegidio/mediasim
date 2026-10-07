import { type ReactNode, useRef, useState } from "react";
import { LoaderCircleIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { MediaKindIcon } from "@/components/MediaKindIcon";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { type MediaFile, renditionUrl } from "@/ipc/thumbs";
import { formatCount, formatSize, totalSize } from "@/lib/format";
import { selectMarkedFiles, usePairResultStore } from "@/stores/pairResult";
import type { DeletionMode } from "@/stores/settings";
import { focusDismiss } from "./DeletionNotice";

/** Twice the 48×36 thumbnail's longer edge, for a sharp picture at 2×. */
const THUMB_BOUND = 96;

/** One file to delete: its thumbnail, or its kind icon when none can be produced, its name and its size. */
const Row = ({ file }: { file: MediaFile }) => {
    const [failed, setFailed] = useState(false);

    return (
        <li className="flex items-center gap-3 border-[#1F1F23] border-b px-3 py-2 last:border-b-0">
            <span className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#18181B] text-muted-foreground [&_svg]:size-4">
                {failed ? (
                    <MediaKindIcon type={file.type} />
                ) : (
                    // Decorative: the name follows.
                    <img
                        alt=""
                        src={renditionUrl(file.identity, THUMB_BOUND)}
                        onError={() => setFailed(true)}
                        className="size-full object-cover"
                    />
                )}
            </span>
            <span title={file.name} className="min-w-0 flex-1 truncate font-mono text-xs">
                {file.name}
            </span>
            <span className="shrink-0 font-mono text-[#A1A1AA] text-xs">{formatSize(file.size)}</span>
        </li>
    );
};

type ConfirmDeletionDialogProps = {
    /** The button that opens the dialog, which focus returns to when it closes without removing anything. */
    children: ReactNode;
};

/**
 * Asks to confirm removing the marked files, listing each with its thumbnail, name and size, then moves them to the
 * Trash or deletes them, in the mode the deletion was asked in. Open while the pair result store's deletion is
 * confirming or removing what it confirmed, never for a restore or a run without confirmation; it can't be closed by a
 * press outside, nor at all while the files are being removed.
 */
export const ConfirmDeletionDialog = ({ children }: ConfirmDeletionDialogProps) => {
    const chosen = usePairResultStore(useShallow(selectMarkedFiles));
    const deletion = usePairResultStore((state) => state.deletion);
    const requestDeletion = usePairResultStore((state) => state.requestDeletion);
    const cancelDeletion = usePairResultStore((state) => state.cancelDeletion);
    const removeMarked = usePairResultStore((state) => state.removeMarked);
    /** Whether the dialog is closing after a removal, rather than a cancel. */
    const moved = useRef(false);

    const removing = deletion.status === "removing" && deletion.confirmed;

    // The files and the mode as confirmed, kept while closing: a removal unmarks the files and ends the deletion, which
    // would otherwise empty the list and change the text as it fades.
    const [mode, setMode] = useState<DeletionMode>("trash");
    if (deletion.status === "confirming" && deletion.mode !== mode) setMode(deletion.mode);
    const [listed, setListed] = useState<MediaFile[]>([]);
    if (
        deletion.status === "confirming" &&
        chosen.map(({ identity }) => identity).join() !== listed.map(({ identity }) => identity).join()
    ) {
        setListed(chosen);
    }

    const count = listed.length;
    const counted = formatCount(count);

    return (
        <AlertDialog
            open={deletion.status === "confirming" || removing}
            onOpenChange={(open) => (open ? void requestDeletion() : cancelDeletion())}
        >
            <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            <AlertDialogContent
                onEscapeKeyDown={(event) => {
                    if (removing) event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                    // After a removal, the trigger is usually disabled, so focus goes to the notice reporting it.
                    if (!moved.current) return;
                    moved.current = false;
                    event.preventDefault();
                    focusDismiss();
                }}
                className="block w-[520px] max-w-[calc(100%-32px)] gap-0 rounded-[16px] border border-[#27272A] bg-[#0F0F11] p-0 shadow-[0_24px_64px_rgba(0,0,0,.6)] ring-0 data-[size=default]:max-w-[calc(100%-32px)] data-[size=default]:sm:max-w-[calc(100%-32px)]"
            >
                <div className="flex gap-3.5 px-6 pt-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(220,38,38,.14)]">
                        <Trash2Icon aria-hidden="true" className="size-5 text-[#F87171]" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                        <AlertDialogTitle className="font-semibold text-[18px]">
                            {mode === "trash" ? `Move ${counted} to Trash?` : `Delete ${counted} permanently?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[#A1A1AA] text-sm leading-normal">
                            {mode === "trash"
                                ? `You can restore ${count === 1 ? "it" : "them"} from the Trash until it is emptied.`
                                : `${count === 1 ? "This file" : "These files"} will be removed from your disk.`}
                        </AlertDialogDescription>
                    </div>
                </div>

                <div className="px-6 pt-5">
                    <ul
                        aria-label="Files to delete"
                        className="max-h-[252px] overflow-y-auto rounded-xl border border-[#27272A] bg-[#111113]"
                    >
                        {listed.map((file) => (
                            <Row key={file.identity} file={file} />
                        ))}
                    </ul>
                    <p className="mt-3 flex justify-between text-[#A1A1AA] text-[13px]">
                        <span>{counted}</span>
                        <span>
                            Total <span className="font-semibold text-[#FAFAFA]">{formatSize(totalSize(listed))}</span>
                        </span>
                    </p>
                </div>

                {mode === "permanent" && (
                    <p className="mx-6 mt-3.5 flex items-start gap-2.5 rounded-[10px] border border-[#7F1D1D] bg-[rgba(220,38,38,.1)] px-3.5 py-3 text-[#FCA5A5] text-[13px]">
                        <TriangleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0" />
                        This cannot be undone. The {count === 1 ? "file" : "files"} won't go to the Trash.
                    </p>
                )}

                <div className="flex items-center gap-2.5 px-6 pt-5 pb-6">
                    <span className="flex-1 text-[#71717A] text-xs">
                        Settings: {mode === "trash" ? "move to Trash" : "delete permanently"}
                    </span>
                    <AlertDialogCancel
                        disabled={removing}
                        className="h-10 rounded-lg border-[#3F3F46] px-4 font-medium text-sm dark:border-[#3F3F46]"
                    >
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={removing}
                        onClick={(event) => {
                            // Radix would close the dialog now; the store closes it once the removal has finished.
                            event.preventDefault();
                            moved.current = true;
                            void removeMarked();
                        }}
                        className="h-10 gap-2 rounded-lg bg-[#DC2626] px-[18px] font-semibold text-sm text-white hover:bg-[#B91C1C] disabled:bg-[#DC2626] disabled:text-white disabled:opacity-60"
                    >
                        {removing && (
                            <LoaderCircleIcon
                                aria-hidden="true"
                                className="size-4 animate-spin motion-reduce:animate-none"
                            />
                        )}
                        {mode === "trash"
                            ? removing
                                ? "Moving…"
                                : "Move to Trash"
                            : removing
                              ? "Deleting…"
                              : "Delete permanently"}
                    </AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};
