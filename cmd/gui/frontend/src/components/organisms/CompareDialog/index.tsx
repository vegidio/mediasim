import { type ChangeEvent, useState } from 'react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    FormControlLabel,
    Radio,
    RadioGroup,
    Slider,
    TextField,
    Typography,
} from '@mui/material';
import { ModalTitle } from '@/components/molecules';
import { type MediaType, useSettingsStore } from '@/stores';

type CompareDialogProps = {
    open: boolean;
    onClose?: () => void;
    onStart?: () => void;
};

export const CompareDialog = ({ open, onClose, onStart }: CompareDialogProps) => {
    const mediaType = useSettingsStore((s) => s.mediaType);
    const setMediaType = useSettingsStore((s) => s.setMediaType);
    const frameFlip = useSettingsStore((s) => s.frameFlip);
    const setFrameFlip = useSettingsStore((s) => s.setFrameFlip);
    const frameRotate = useSettingsStore((s) => s.frameRotate);
    const setFrameRotate = useSettingsStore((s) => s.setFrameRotate);
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
        <Dialog
            open={open}
            maxWidth='sm'
            fullWidth
            onClose={(_event, reason) => {
                if (reason === 'backdropClick') return;
                onClose?.();
            }}
        >
            <ModalTitle title='Settings' onClose={onClose} />

            <DialogContent className='flex flex-col gap-5 pt-2!'>
                {/* Media type */}
                <div className='flex items-center justify-between'>
                    <Typography variant='body1'>Media type</Typography>
                    <RadioGroup row value={mediaType} onChange={(e) => setMediaType(e.target.value as MediaType)}>
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
                <Button variant='contained' onClick={() => onStart?.()}>
                    Start
                </Button>
            </DialogActions>
        </Dialog>
    );
};
