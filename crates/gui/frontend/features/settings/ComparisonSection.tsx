import { useId } from "react";
import { Slider } from "@/components/ui/slider";
import { MATCH_THRESHOLD_MAX, MATCH_THRESHOLD_MIN, useSettingsStore } from "@/stores/settings";
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
                    <Slider
                        aria-labelledby={`${id}-name`}
                        aria-describedby={`${id}-hint`}
                        min={MATCH_THRESHOLD_MIN}
                        max={MATCH_THRESHOLD_MAX}
                        step={1}
                        value={[matchThreshold]}
                        onValueChange={([value]) => value !== undefined && update({ matchThreshold: value })}
                        className="w-40 cursor-pointer"
                        trackClassName="bg-[#3F3F46] data-horizontal:h-1"
                        rangeClassName="bg-[#BEF264]"
                        thumbClassName="size-3.5 border-0 bg-[#BEF264] ring-[#BEF264]/40"
                    />
                    <span className="w-10 text-right font-mono text-[#E4E4E7] text-[13px] tabular-nums">
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
                name="Frame rotate"
                hint="Also compare each frame rotated 90°, 180° and 270°."
                checked={frameRotate}
                onCheckedChange={(checked) => update({ frameRotate: checked })}
            />
            <SettingSwitch
                name="Frame flip"
                hint="Also compare each frame flipped vertically and horizontally."
                checked={frameFlip}
                onCheckedChange={(checked) => update({ frameFlip: checked })}
            />
        </SettingsSection>
    );
};
