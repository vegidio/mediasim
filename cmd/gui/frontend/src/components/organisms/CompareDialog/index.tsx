import { type ChangeEvent, useState } from 'react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Radio,
    RadioGroup,
    Slider,
    TextField,
    Typography,
} from '@mui/material';

export type CompareSettings = {
    mediaType: 'all' | 'images' | 'videos';
    frameFlip: boolean;
    frameRotate: boolean;
    threshold: number;
};

type CompareDialogProps = {
    open: boolean;
    onClose?: () => void;
    onStart?: (settings: CompareSettings) => void;
};

export const CompareDialog = ({ open, onClose, onStart }: CompareDialogProps) => {
    const [mediaType, setMediaType] = useState('all');
    const [frameFlip, setFrameFlip] = useState(false);
    const [frameRotate, setFrameRotate] = useState(false);
    const [threshold, setThreshold] = useState(0.8);
    const [thresholdText, setThresholdText] = useState('0.8');

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
        <Dialog open={open} maxWidth='sm' fullWidth onClose={onClose}>
            <DialogTitle>Compare Settings</DialogTitle>

            <DialogContent className='flex flex-col gap-5 pt-2!'>
                {/* Media type */}
                <div className='flex items-center justify-between'>
                    <Typography variant='body1'>Media type</Typography>
                    <RadioGroup row value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
                        <FormControlLabel value='all' control={<Radio size='small' />} label='All' />
                        <FormControlLabel value='images' control={<Radio size='small' />} label='Images' />
                        <FormControlLabel value='videos' control={<Radio size='small' />} label='Videos' />
                    </RadioGroup>
                </div>

                {/* Extra comparisons */}
                <div className='flex items-center justify-between'>
                    <Typography variant='body1'>Extra comparisons</Typography>

                    <div className='flex'>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    size='small'
                                    checked={frameFlip}
                                    onChange={(e) => setFrameFlip(e.target.checked)}
                                />
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

                {/* Similarity threshold */}
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
            </DialogContent>

            <DialogActions className='px-6 pb-4'>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant='contained'
                    onClick={() =>
                        onStart?.({
                            mediaType: mediaType as CompareSettings['mediaType'],
                            frameFlip,
                            frameRotate,
                            threshold,
                        })
                    }
                >
                    Start
                </Button>
            </DialogActions>
        </Dialog>
    );
};
