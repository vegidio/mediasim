import { FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { type MediaType, useSettingsStore } from '@/stores';

export const MediaTypeSection = () => {
    const mediaType = useSettingsStore((s) => s.mediaType);
    const setMediaType = useSettingsStore((s) => s.setMediaType);

    return (
        <div className='flex items-center justify-between'>
            <Typography variant='body1'>Media type</Typography>
            <RadioGroup row value={mediaType} onChange={(e) => setMediaType(e.target.value as MediaType)}>
                <FormControlLabel value='all' control={<Radio size='small' />} label='All' />
                <FormControlLabel value='images' control={<Radio size='small' />} label='Images' />
                <FormControlLabel value='videos' control={<Radio size='small' />} label='Videos' />
            </RadioGroup>
        </div>
    );
};
