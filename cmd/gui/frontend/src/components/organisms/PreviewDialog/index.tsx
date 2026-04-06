import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { GetImage } from '@bindings/gui/services/mediaservice.js';
import { StartStream, StopStream } from '@bindings/gui/services/streamer.js';
import { basename } from 'pathe';
import { ModalTitle, VideoPlayer } from '@/components/molecules';
import { VIDEO_EXTENSIONS } from '@/utils/constants';
import { toDataUrl } from '@/utils/image';
import { getCachedThumbnail } from '@/utils/thumbnailCache';

type PreviewDialogProps = {
    path?: string;
    onClose: () => void;
};

const PADDING = 32;
const TITLE_HEIGHT = 41;

const getExtension = (path: string): string => path.slice(path.lastIndexOf('.')).toLowerCase();

export const PreviewDialog = ({ path, onClose }: PreviewDialogProps) => {
    const [fullSizeUrl, setFullSizeUrl] = useState<string>();
    const [hlsUrl, setHlsUrl] = useState<string>();
    const open = path !== undefined;
    const isVideo = path !== undefined && VIDEO_EXTENSIONS.has(getExtension(path));

    useEffect(() => {
        if (!path) return;
        setFullSizeUrl(undefined);
        setHlsUrl(undefined);

        if (VIDEO_EXTENSIONS.has(getExtension(path))) {
            const promise = StartStream(path);
            promise.then((url) => setHlsUrl(url));

            return () => {
                promise.cancel();
                StopStream();
            };
        }

        const promise = GetImage(path, 0);
        promise.then(([data]) => setFullSizeUrl(toDataUrl(data)));

        return () => {
            promise.cancel();
        };
    }, [path]);

    if (!path) return undefined;

    const cached = getCachedThumbnail(path);
    const filename = basename(path);
    const displayUrl = fullSizeUrl ?? cached?.dataUrl;

    const origW = cached?.width ?? 1;
    const origH = cached?.height ?? 1;
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
            <div className='w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin' />
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
                    hlsUrl ? (
                        <VideoPlayer src={hlsUrl} width={dialogW} height={dialogH} />
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
