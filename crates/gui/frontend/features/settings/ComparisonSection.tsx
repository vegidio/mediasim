import { useId } from "react";
import { ThresholdSlider } from "@/components/ThresholdSlider";
import { FRAME_OPTIONS, useSettingsStore } from "@/stores/settings";
import { SettingSwitch } from "./SettingSwitch";
import { SettingRow, SettingsSection } from "./SettingsSection";

/** The default match threshold: a slider in whole percent, with its value beside it. */
const ThresholdRow = () => {
    const matchThreshold = useSettingsStore((state) => state.matchThreshold);
    const update = useSettingsStore((state) => state.update);
    const id = useId();

    return (
        // A `div`, not a label: a press on the row's text shouldn't move the slider.
        <SettingRow
            as="div"
            name="Default match threshold"
            hint="Files at or above this similarity are grouped. You can still change it per scan."
            nameId={`${id}-name`}
            hintId={`${id}-hint`}
            control={
                <div className="flex shrink-0 items-center gap-3">
                    <ThresholdSlider
                        aria-labelledby={`${id}-name`}
                        aria-describedby={`${id}-hint`}
                        value={matchThreshold}
                        onChange={(value) => update({ matchThreshold: value })}
                        className="w-40"
                    />
                    <span className="w-10 text-right font-mono text-text-label text-[13px] tabular-nums">
                        {matchThreshold}%
                    </span>
                </div>
            }
        />
    );
};

/** The "Comparison" section: the defaults a scan starts from, and the extra frame orientations to compare. */
export const ComparisonSection = () => {
    const scanSubfolders = useSettingsStore((state) => state.scanSubfolders);
    const frameRotate = useSettingsStore((state) => state.frameRotate);
    const frameFlip = useSettingsStore((state) => state.frameFlip);
    const update = useSettingsStore((state) => state.update);

    return (
        <SettingsSection title="Comparison">
            <ThresholdRow />
            <SettingSwitch
                name="Scan subfolders"
                hint="Include files inside nested folders by default."
                checked={scanSubfolders}
                onCheckedChange={(checked) => update({ scanSubfolders: checked })}
            />
            <SettingSwitch
                name={FRAME_OPTIONS.frameRotate.name}
                hint={`${FRAME_OPTIONS.frameRotate.hint}.`}
                checked={frameRotate}
                onCheckedChange={(checked) => update({ frameRotate: checked })}
            />
            <SettingSwitch
                name={FRAME_OPTIONS.frameFlip.name}
                hint={`${FRAME_OPTIONS.frameFlip.hint}.`}
                checked={frameFlip}
                onCheckedChange={(checked) => update({ frameFlip: checked })}
            />
        </SettingsSection>
    );
};
