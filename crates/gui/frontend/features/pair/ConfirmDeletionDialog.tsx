import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { DeletionDialog, deletionDialogProps } from "@/components/deletion/DeletionDialog";
import { selectMarkedFiles, usePairResultStore } from "@/stores/pairResult";

type ConfirmDeletionDialogProps = {
    /** The button that opens the dialog, which focus returns to when it closes without removing anything. */
    children: ReactNode;
};

/** The deletion dialog for the pair's marked files, in the mode the deletion was asked in. */
export const ConfirmDeletionDialog = ({ children }: ConfirmDeletionDialogProps) => {
    const chosen = usePairResultStore(useShallow(selectMarkedFiles));
    const deletion = usePairResultStore((state) => state.deletion);
    const requestDeletion = usePairResultStore((state) => state.requestDeletion);
    const cancelDeletion = usePairResultStore((state) => state.cancelDeletion);
    const removeMarked = usePairResultStore((state) => state.removeMarked);

    return (
        <DeletionDialog
            {...deletionDialogProps(deletion, requestDeletion, cancelDeletion)}
            files={chosen}
            onConfirm={() => void removeMarked()}
        >
            {children}
        </DeletionDialog>
    );
};
