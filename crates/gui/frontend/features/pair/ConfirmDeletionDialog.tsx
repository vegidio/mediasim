import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { DeletionDialog } from "@/components/deletion/DeletionDialog";
import { selectMarkedFiles, usePairResultStore } from "@/stores/pairResult";

type ConfirmDeletionDialogProps = {
    /** The button that opens the dialog, which focus returns to when it closes without removing anything. */
    children: ReactNode;
};

/**
 * The deletion dialog for the pair's marked files, in the mode the deletion was asked in. Open while the pair result
 * store's deletion is confirming or removing what it confirmed, never for a restore or a run without confirmation.
 */
export const ConfirmDeletionDialog = ({ children }: ConfirmDeletionDialogProps) => {
    const chosen = usePairResultStore(useShallow(selectMarkedFiles));
    const deletion = usePairResultStore((state) => state.deletion);
    const requestDeletion = usePairResultStore((state) => state.requestDeletion);
    const cancelDeletion = usePairResultStore((state) => state.cancelDeletion);
    const removeMarked = usePairResultStore((state) => state.removeMarked);

    const removing = deletion.status === "removing" && deletion.confirmed;

    return (
        <DeletionDialog
            open={deletion.status === "confirming" || removing}
            mode={"mode" in deletion ? deletion.mode : "trash"}
            files={chosen}
            removing={removing}
            onOpenChange={(open) => (open ? void requestDeletion() : cancelDeletion())}
            onConfirm={() => void removeMarked()}
        >
            {children}
        </DeletionDialog>
    );
};
