import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { MATCH_THRESHOLD_MAX, MATCH_THRESHOLD_MIN } from "@/stores/settings";

type ThresholdSliderProps = {
    /** The match threshold, in whole percent. */
    value: number;
    onChange: (value: number) => void;
    /** The slider's width. */
    className: string;
    "aria-labelledby": string;
    "aria-describedby"?: string;
};

/** A match threshold slider, in whole percent, from the lowest to the highest a scan allows. */
export const ThresholdSlider = ({ value, onChange, className, ...aria }: ThresholdSliderProps) => (
    <Slider
        {...aria}
        min={MATCH_THRESHOLD_MIN}
        max={MATCH_THRESHOLD_MAX}
        step={1}
        value={[value]}
        onValueChange={([next]) => next !== undefined && onChange(next)}
        className={cn("cursor-pointer", className)}
        trackClassName="bg-border-strong data-horizontal:h-1"
        rangeClassName="bg-primary"
        thumbClassName="size-3.5 border-0 bg-primary ring-primary/40"
    />
);
