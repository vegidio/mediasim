import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, LinearProgress, Typography } from '@mui/material';
import { StartComparison } from '@bindings/gui/services/comparisonservice';
import { Events } from '@wailsio/runtime';
import { ModalTitle } from '@/components/molecules';
import { useAppStore, useComparisonStore, useSettingsStore } from '@/stores';

type ProgressDialogProps = {
    open: boolean;
    onClose?: () => void;
};

export const ProgressDialog = ({ open, onClose }: ProgressDialogProps) => {
    const directory = useAppStore((s) => s.selectedDirectory ?? '');
    const threshold = useSettingsStore((s) => s.threshold);
    const mediaType = useSettingsStore((s) => s.mediaType);
    const frameFlip = useSettingsStore((s) => s.frameFlip);
    const frameRotate = useSettingsStore((s) => s.frameRotate);
    const setGroups = useComparisonStore((s) => s.setGroups);

    const [current, setCurrent] = useState(0);
    const [total, setTotal] = useState(0);
    const promiseRef = useRef<{ cancel: () => void } | undefined>(undefined);

    // Only re-run when `open` changes — other values are set before the dialog opens
    // and must not restart the comparison mid-progress.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
    useEffect(() => {
        if (!open) return;

        setCurrent(0);
        setTotal(0);

        const offProgress = Events.On('comparison:progress', (event: { data: unknown }) => {
            const { current: c, total: t } = event.data as { current: number; total: number };
            setCurrent(c);
            setTotal(t);
        });

        const includeImages = mediaType === 'all' || mediaType === 'images';
        const includeVideos = mediaType === 'all' || mediaType === 'videos';

        const promise = StartComparison(directory, includeImages, includeVideos, frameFlip, frameRotate, threshold);
        promiseRef.current = promise;

        promise
            .then((groups) => {
                setGroups(groups);
                onClose?.();
            })
            .catch(() => {
                // Cancelled or error — dialog closes via onClose
            });

        return () => {
            offProgress();
            promiseRef.current = undefined;
        };
    }, [open]);

    const handleCancel = () => {
        promiseRef.current?.cancel();
        onClose?.();
    };

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;

    return (
        <Dialog
            open={open}
            maxWidth='sm'
            fullWidth
            disableEscapeKeyDown
            onClose={(_event, reason) => {
                if (reason === 'backdropClick') return;
            }}
        >
            <ModalTitle title='Comparing...' onClose={handleCancel} />

            <DialogContent className='flex flex-col gap-4 pt-5!'>
                <Typography variant='body1'>Calculating similarity in the directory {directory}</Typography>
                <Typography variant='body1'>
                    Grouping media with at least {threshold} similarity threshold...
                </Typography>

                <div className='flex flex-col gap-1'>
                    <LinearProgress variant='determinate' value={percent} />
                    <div className='flex justify-between'>
                        <Typography variant='body2' color='textSecondary'>
                            [{current}/{total}]
                        </Typography>
                        <Typography variant='body2' color='textSecondary'>
                            {percent}%
                        </Typography>
                    </div>
                </div>
            </DialogContent>

            <DialogActions className='px-6 pb-4'>
                <Button onClick={handleCancel}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
};
