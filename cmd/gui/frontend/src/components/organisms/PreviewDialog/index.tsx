import { Dialog, DialogContent } from '@mui/material';
import { basename } from 'pathe';
import { useImagePreview } from './useImagePreview';
import { useVideoPreview } from './useVideoPreview';
import { Spinner } from '@/components/atoms';
import { ModalTitle, VideoPlayer } from '@/components/molecules';
import { getCachedThumbnail } from '@/utils/thumbnailCache';

type PreviewDialogProps = {
    path?: string;
    onClose: () => void;
};

const PADDING = 32;
const TITLE_HEIGHT = 41;

export const PreviewDialog = ({ path, onClose }: PreviewDialogProps) => {
    const { isVideo, videoUrl, videoType, onError } = useVideoPreview(path);
    const { fullSizeUrl, fullSizeDims } = useImagePreview(path, isVideo);
    const open = path !== undefined;

    if (!path) return undefined;

    const cached = getCachedThumbnail(path);
    const filename = basename(path);
    const displayUrl = fullSizeUrl ?? cached?.url;

    const origW = fullSizeDims?.width ?? cached?.width ?? 1;
    const origH = fullSizeDims?.height ?? cached?.height ?? 1;
    const aspectRatio = origW / origH;

    const maxW = window.innerWidth - PADDING * 2;
    const maxH = window.innerHeight - PADDING * 2 - TITLE_HEIGHT;

    let dialogW: number;
    let dialogH: number;

    if (maxW / maxH > aspectRatio) {
        dialogH = maxH;
        dialogW = maxH * aspectRatio;
    } else {
        dialogW = maxW;
        dialogH = maxW / aspectRatio;
    }

    const spinner = (
        <div className='flex items-center justify-center' style={{ width: dialogW, height: dialogH }}>
            <Spinner />
        </div>
    );

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={false}
            slotProps={{
                paper: {
                    className: 'overflow-hidden',
                    style: { width: dialogW, maxWidth: dialogW },
                },
            }}
        >
            <ModalTitle title={filename} onClose={onClose} />

            <DialogContent className='p-0! flex items-center justify-center bg-black overflow-hidden'>
                {isVideo ? (
                    videoUrl ? (
                        <VideoPlayer
                            src={videoUrl}
                            type={videoType}
                            width={dialogW}
                            height={dialogH}
                            onError={onError}
                        />
                    ) : (
                        spinner
                    )
                ) : displayUrl ? (
                    <img
                        src={displayUrl}
                        alt={filename}
                        style={{ width: dialogW, height: dialogH }}
                        className={`object-contain ${!fullSizeUrl ? 'blur-sm' : ''}`}
                    />
                ) : (
                    spinner
                )}
            </DialogContent>
        </Dialog>
    );
};
