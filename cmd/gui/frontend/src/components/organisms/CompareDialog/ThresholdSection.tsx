import { type ChangeEvent, useState } from 'react';
import { Slider, TextField, Typography } from '@mui/material';
import { useSettingsStore } from '@/stores';

export const ThresholdSection = () => {
    const threshold = useSettingsStore((s) => s.threshold);
    const setThreshold = useSettingsStore((s) => s.setThreshold);
    const [thresholdText, setThresholdText] = useState(String(threshold));

    const handleThresholdSliderChange = (_: Event, value: number | number[]) => {
        const num = value as number;
        setThreshold(num);
        setThresholdText(String(num));
    };

    const handleThresholdInputChange = (e: ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(',', '.');

        // Allow only digits and a single decimal point
        if (!/^\d*\.?\d*$/.test(raw)) return;

        // Block values that would exceed 1
        const parsed = Number.parseFloat(raw);
        if (!Number.isNaN(parsed) && parsed > 1) return;

        setThresholdText(raw);

        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            setThreshold(parsed);
        }
    };

    const handleThresholdInputBlur = () => {
        setThresholdText(String(threshold));
    };

    return (
        <div className='flex items-center justify-between gap-4'>
            <Typography variant='body1' className='shrink-0'>
                Similarity threshold
            </Typography>

            <div className='flex flex-1 items-center gap-3'>
                <Slider value={threshold} min={0} max={1} step={0.01} onChange={handleThresholdSliderChange} />
                <TextField
                    value={thresholdText}
                    size='small'
                    className='w-24 shrink-0'
                    onChange={handleThresholdInputChange}
                    onBlur={handleThresholdInputBlur}
                />
            </div>
        </div>
    );
};
