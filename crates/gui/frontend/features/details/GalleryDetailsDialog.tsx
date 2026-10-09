import { CircleMinusIcon, CirclePlusIcon } from "lucide-react";
import type { MediaType } from "@/ipc/formats";
import type { MediaFile } from "@/ipc/thumbs";
import { cn } from "@/lib/utils";
import { useGalleryStore } from "@/stores/gallery";
import { type Inclusion, inclusion } from "../gallery/derive";
import { DetailsDialog } from "./DetailsDialog";
import { ACTION, Chip, kindLabel } from "./DetailsSidebar";
import { indexOfPath, position } from "./navigate";

/** The chip saying why a file is not in the comparison, and what the button that flips it reads. */
const INCLUSION_UI: Record<Inclusion, { chip?: string; action: string }> = {
    included: { action: "Remove from comparison" },
    removed: { chip: "Removed", action: "Add back to comparison" },
    "left-out": { chip: "Not included", action: "Add to comparison" },
};

/** The kind chip, then the chip saying why the file is not in the comparison, if it isn't. */
export const InclusionChips = ({ type, inclusion }: { type: MediaType; inclusion: Inclusion }) => {
    const { chip } = INCLUSION_UI[inclusion];

    return (
        <>
            <Chip>{kindLabel(type)}</Chip>
            {chip && <Chip>{chip}</Chip>}
        </>
    );
};

/** The button that takes the file out of the comparison, or puts it in. */
export const InclusionButton = ({ inclusion, onToggle }: { inclusion: Inclusion; onToggle: () => void }) => (
    <button type="button" onClick={onToggle} className={cn(ACTION, "h-[38px] gap-2 text-sm")}>
        {inclusion === "included" ? (
            <CircleMinusIcon aria-hidden="true" className="size-[15px]" />
        ) : (
            <CirclePlusIcon aria-hidden="true" className="size-[15px]" />
        )}
        {INCLUSION_UI[inclusion].action}
    </button>
);

type GalleryDetailsDialogProps = {
    /** Every file of the gallery, in grid order. */
    files: readonly MediaFile[];
    /** The one to show, which is one of `files`. */
    file: MediaFile;
};

/**
 * The media details of one of the gallery's files over the dimmed gallery, stepping through every file of the gallery,
 * whatever the tab, with the button that takes the file out of the comparison or puts it in.
 */
export const GalleryDetailsDialog = ({ files, file }: GalleryDetailsDialogProps) => {
    const filter = useGalleryStore((state) => state.filter);
    const showDetails = useGalleryStore((state) => state.showDetails);
    const closeDetails = useGalleryStore((state) => state.closeDetails);
    const overrides = useGalleryStore((state) => state.overrides);
    const toggle = useGalleryStore((state) => state.toggle);
    const included = inclusion(file.type, filter, overrides.has(file.path));

    return (
        <DetailsDialog
            files={files}
            file={file}
            position={position(indexOfPath(files, file.path), files.length)}
            onShow={(target) => showDetails(target.path)}
            onClose={closeDetails}
            chips={<InclusionChips type={file.type} inclusion={included} />}
            action={<InclusionButton inclusion={included} onToggle={() => toggle(file.path)} />}
            onToggle={() => toggle(file.path)}
            // Faded as the gallery's tiles are: removed, or left out by the tab and not added.
            isDimmed={(target) => inclusion(target.type, filter, overrides.has(target.path)) !== "included"}
        />
    );
};
