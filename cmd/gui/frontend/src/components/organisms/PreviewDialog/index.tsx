import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import { GetImage } from '@bindings/gui/services/mediaservice.js';
import { PrepareDirectPlay, StartStream, StopStream } from '@bindings/gui/services/streamer.js';
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
    const [fullSizeDims, setFullSizeDims] = useState<{ width: number; height: number }>();
    const [videoUrl, setVideoUrl] = useState<string>();
    const [videoType, setVideoType] = useState<string>();
    const [fallback, setFallback] = useState(false);
    const open = path !== undefined;
    const isVideo = path !== undefined && VIDEO_EXTENSIONS.has(getExtension(path));

    useEffect(() => {
        if (!path) return;
        setFullSizeUrl(undefined);
        setFullSizeDims(undefined);
        setVideoUrl(undefined);
        setVideoType(undefined);
        setFallback(false);

        if (VIDEO_EXTENSIONS.has(getExtension(path))) {
            const promise = PrepareDirectPlay(path);
            promise.then((url) => setVideoUrl(url));

            return () => {
                promise.cancel();
                StopStream();
            };
        }

        const promise = GetImage(path, 0);
        promise.then(([data, width, height]) => {
            setFullSizeUrl(toDataUrl(data));
            setFullSizeDims({ width, height });
        });

        return () => {
            promise.cancel();
        };
    }, [path]);

    const handleVideoError = () => {
        if (!path || fallback) return;
        setFallback(true);
        setVideoUrl(undefined);
        StartStream(path).then((url) => {
            setVideoUrl(url);
            setVideoType('application/x-mpegURL');
        });
    };

    if (!path) return undefined;

    const cached = getCachedThumbnail(path);
    const filename = basename(path);
    const displayUrl = fullSizeUrl ?? cached?.dataUrl;

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
                    videoUrl ? (
                        <VideoPlayer
                            src={videoUrl}
                            type={videoType}
                            width={dialogW}
                            height={dialogH}
                            onError={handleVideoError}
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
