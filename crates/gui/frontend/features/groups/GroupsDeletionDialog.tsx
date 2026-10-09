import type { ReactNode } from "react";
import { DeletionDialog, deletionDialogProps } from "@/components/deletion/DeletionDialog";
import type { GroupFile } from "@/ipc/scan";
import { selectMedia, useScanStore } from "@/stores/scan";

type GroupsDeletionDialogProps = {
    /** The marked files still shown, in the groups' order and each group's order. */
    marked: readonly GroupFile[];
    /** The button that opens the dialog, which focus returns to when it closes without removing anything. */
    children: ReactNode;
};

/** The deletion dialog for the groups screen's marked files, in the mode the deletion was asked in. */
export const GroupsDeletionDialog = ({ marked, children }: GroupsDeletionDialogProps) => {
    const media = useScanStore(selectMedia);
    const deletion = useScanStore((state) => state.deletion);
    const requestDeletion = useScanStore((state) => state.requestDeletion);
    const cancelDeletion = useScanStore((state) => state.cancelDeletion);
    const removeMarked = useScanStore((state) => state.removeMarked);

    const files = marked.flatMap((file) => media.get(file.path) ?? []);

    return (
        <DeletionDialog
            {...deletionDialogProps(deletion, requestDeletion, cancelDeletion)}
            files={files}
            onConfirm={() => void removeMarked()}
        >
            {children}
        </DeletionDialog>
    );
};
