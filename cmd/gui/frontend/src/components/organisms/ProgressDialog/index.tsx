import { Button, Dialog, DialogActions, DialogContent, LinearProgress, Typography } from '@mui/material';

type ProgressDialogProps = {
    open: boolean;
    directory: string;
    threshold: number;
    onClose?: () => void;
};

export const ProgressDialog = ({ open, directory, threshold, onClose }: ProgressDialogProps) => {
    const current = 123;
    const total = 300;
    const percent = Math.round((current / total) * 100);

    return (
        <Dialog open={open} maxWidth='sm' fullWidth>
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
                <Button onClick={onClose}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
};
