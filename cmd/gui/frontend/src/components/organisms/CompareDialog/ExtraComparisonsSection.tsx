import { Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useSettingsStore } from '@/stores';

export const ExtraComparisonsSection = () => {
    const frameFlip = useSettingsStore((s) => s.frameFlip);
    const setFrameFlip = useSettingsStore((s) => s.setFrameFlip);
    const frameRotate = useSettingsStore((s) => s.frameRotate);
    const setFrameRotate = useSettingsStore((s) => s.setFrameRotate);

    return (
        <div className='flex items-center justify-between'>
            <Typography variant='body1'>Extra comparisons</Typography>

            <div className='flex'>
                <FormControlLabel
                    control={
                        <Checkbox size='small' checked={frameFlip} onChange={(e) => setFrameFlip(e.target.checked)} />
                    }
                    label='Frame Flip'
                />

                <FormControlLabel
                    control={
                        <Checkbox
                            size='small'
                            checked={frameRotate}
                            onChange={(e) => setFrameRotate(e.target.checked)}
                        />
                    }
                    label='Frame Rotate'
                />
            </div>
        </div>
    );
};
