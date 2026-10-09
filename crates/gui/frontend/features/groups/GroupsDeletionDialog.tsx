import { type ReactNode, useMemo } from "react";
import { DeletionDialog } from "@/components/deletion/DeletionDialog";
import type { GroupFile } from "@/ipc/scan";
import type { MediaFile } from "@/ipc/thumbs";
import { useScanStore } from "@/stores/scan";

type GroupsDeletionDialogProps = {
    /** The marked files still shown, in the groups' order and each group's order. */
    marked: readonly GroupFile[];
    /** The scanned files by path, which give each marked file its name and thumbnail. */
    media: ReadonlyMap<string, MediaFile>;
    /** The button that opens the dialog, which focus returns to when it closes without removing anything. */
    children: ReactNode;
};

/**
 * The deletion dialog for the groups screen's marked files, in the mode the deletion was asked in. Open while the scan
 * store's deletion is confirming or removing what it confirmed, never for a restore or a run without confirmation.
 */
export const GroupsDeletionDialog = ({ marked, media, children }: GroupsDeletionDialogProps) => {
    const deletion = useScanStore((state) => state.deletion);
    const requestDeletion = useScanStore((state) => state.requestDeletion);
    const cancelDeletion = useScanStore((state) => state.cancelDeletion);
    const removeMarked = useScanStore((state) => state.removeMarked);

    const files = useMemo(() => marked.flatMap((file) => media.get(file.path) ?? []), [marked, media]);
    const removing = deletion.status === "removing" && deletion.confirmed;

    return (
        <DeletionDialog
            open={deletion.status === "confirming" || removing}
            mode={"mode" in deletion ? deletion.mode : "trash"}
            files={files}
            removing={removing}
            onOpenChange={(open) => (open ? void requestDeletion() : cancelDeletion())}
            onConfirm={() => void removeMarked()}
        >
            {children}
        </DeletionDialog>
    );
};
