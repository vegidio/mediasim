import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "./SettingsSection";

type SettingSwitchProps = {
    /** The setting's name, which also names the switch. */
    name: string;
    /** The one-line explanation under the name, which also describes the switch. */
    hint: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
};

/** An on/off setting: a whole row that toggles 10a's switch at its end. */
export const SettingSwitch = ({ name, hint, checked, onCheckedChange }: SettingSwitchProps) => {
    const hintId = useId();

    return (
        <SettingRow
            name={name}
            hint={hint}
            hintId={hintId}
            control={
                <Switch
                    aria-label={name}
                    aria-describedby={hintId}
                    checked={checked}
                    onCheckedChange={onCheckedChange}
                    className="border-0 p-0.5 data-[size=default]:h-[22px] data-[size=default]:w-10 data-checked:bg-primary data-unchecked:bg-border-strong dark:data-unchecked:bg-border-strong"
                    thumbClassName="bg-foreground shadow-[0_1px_2px_rgba(0,0,0,.4)] group-data-[size=default]/switch:size-[18px] group-data-[size=default]/switch:data-checked:translate-x-[18px] dark:data-checked:bg-foreground dark:data-unchecked:bg-foreground"
                />
            }
        />
    );
};
