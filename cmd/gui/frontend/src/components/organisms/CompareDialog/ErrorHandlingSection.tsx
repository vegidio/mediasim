import { Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useSettingsStore } from '@/stores';

export const ErrorHandlingSection = () => {
    const ignoreErrors = useSettingsStore((s) => s.ignoreErrors);
    const setIgnoreErrors = useSettingsStore((s) => s.setIgnoreErrors);

    return (
        <div className='flex items-center justify-between'>
            <Typography variant='body1'>Error handling</Typography>

            <div className='flex'>
                <FormControlLabel
                    control={
                        <Checkbox
                            size='small'
                            checked={ignoreErrors}
                            onChange={(e) => setIgnoreErrors(e.target.checked)}
                        />
                    }
                    label='Ignore Errors'
                />
            </div>
        </div>
    );
};
