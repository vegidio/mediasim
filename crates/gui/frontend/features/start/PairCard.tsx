import { useId } from "react";
import { Columns2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dropTargetClassName, ModeCard } from "@/features/start/ModeCard";
import { cn } from "@/lib/utils";

/** An empty, not-yet-operable slot for one of the two files. */
const FileSlot = ({ label }: { label: string }) => {
    const labelId = useId();
    const hintId = useId();

    return (
        <button
            type="button"
            disabled
            aria-labelledby={labelId}
            aria-describedby={hintId}
            className={cn(dropTargetClassName, "h-[210px] w-full")}
        >
            <UploadIcon aria-hidden="true" />
            <span id={labelId} className="font-medium text-foreground text-sm">
                {label}
            </span>
            <span id={hintId}>Drop or click to choose</span>
        </button>
    );
};

/** The "Compare two files" mode card, in its empty state. */
export const PairCard = () => (
    <ModeCard
        icon={<Columns2Icon aria-hidden="true" />}
        title="Compare two files"
        description="Get one similarity score for two images or two videos."
    >
        <div className="grid grid-cols-2 gap-3">
            <FileSlot label="File A" />
            <FileSlot label="File B" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-4">
            <span className="text-[13px] text-muted-foreground">Both files must be images, or both videos.</span>
            <Button disabled className="h-10 px-[18px] text-sm">
                Compare
            </Button>
        </div>
    </ModeCard>
);
