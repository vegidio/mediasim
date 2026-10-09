import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DELETION_MODES, type DeletionMode, useSettingsStore } from "@/stores/settings";
import { SettingSwitch } from "./SettingSwitch";
import { SettingRow, SettingsSection } from "./SettingsSection";

/** Each mode's option: its name, its explanation, and the colour its indicator takes when selected. */
const OPTIONS: Record<DeletionMode, { name: string; hint: string; ring: string; dot: string }> = {
    trash: {
        name: "Move to Trash",
        hint: "Files can be restored from the Trash.",
        ring: "data-checked:border-primary",
        dot: "bg-primary",
    },
    permanent: {
        name: "Delete permanently",
        hint: "Frees space immediately. This cannot be undone.",
        ring: "data-checked:border-danger-bright",
        dot: "bg-danger-bright",
    },
};

const isDeletionMode = (value: string): value is DeletionMode => (DELETION_MODES as readonly string[]).includes(value);

/** One deletion mode, as a whole row with its indicator first. */
const ModeOption = ({ mode }: { mode: DeletionMode }) => {
    const id = useId();
    const { name, hint, ring, dot } = OPTIONS[mode];

    return (
        <SettingRow
            name={name}
            hint={hint}
            nameId={`${id}-name`}
            hintId={`${id}-hint`}
            leading
            control={
                <RadioGroupItem
                    value={mode}
                    aria-labelledby={`${id}-name`}
                    aria-describedby={`${id}-hint`}
                    className={`size-[18px] border-[1.5px] border-border-hover bg-transparent dark:bg-transparent data-checked:bg-transparent dark:data-checked:bg-transparent ${ring}`}
                    indicatorClassName={dot}
                />
            }
        />
    );
};

/** The "Deleting files" section: whether marked files go to the Trash or are deleted, and whether to confirm first. */
export const DeletingFilesSection = () => {
    const deletionMode = useSettingsStore((state) => state.deletionMode);
    const confirmDeletion = useSettingsStore((state) => state.confirmDeletion);
    const update = useSettingsStore((state) => state.update);

    return (
        <SettingsSection title="Deleting files">
            <RadioGroup
                aria-label="When deleting marked files"
                value={deletionMode}
                onValueChange={(value) => {
                    if (isDeletionMode(value)) update({ deletionMode: value });
                }}
                className="gap-0 [&>*+*]:border-border-subtle [&>*+*]:border-t"
            >
                {DELETION_MODES.map((mode) => (
                    <ModeOption key={mode} mode={mode} />
                ))}
            </RadioGroup>
            <SettingSwitch
                name="Confirm before deleting"
                hint="Show a summary of the marked files before anything is removed."
                checked={confirmDeletion}
                onCheckedChange={(checked) => update({ confirmDeletion: checked })}
            />
        </SettingsSection>
    );
};
