import { useEffect, useState } from 'react';
import { PrepareDirectPlay, StartStream, StopStream } from '@bindings/gui/services/streamer.js';
import { VIDEO_EXTENSIONS } from '@/utils/constants';

const getExtension = (path: string): string => path.slice(path.lastIndexOf('.')).toLowerCase();

export const useVideoPreview = (path?: string) => {
    const [videoUrl, setVideoUrl] = useState<string>();
    const [videoType, setVideoType] = useState<string>();
    const [fallback, setFallback] = useState(false);

    const isVideo = path !== undefined && VIDEO_EXTENSIONS.has(getExtension(path));

    useEffect(() => {
        setVideoUrl(undefined);
        setVideoType(undefined);
        setFallback(false);

        if (!path || !isVideo) return;

        const promise = PrepareDirectPlay(path);
        promise.then((url) => setVideoUrl(url));

        return () => {
            promise.cancel();
            StopStream();
        };
    }, [path, isVideo]);

    const onError = () => {
        if (!path || fallback) return;
        setFallback(true);
        setVideoUrl(undefined);
        StartStream(path).then((url) => {
            setVideoUrl(url);
            setVideoType('application/x-mpegURL');
        });
    };

    return { isVideo, videoUrl, videoType, onError };
};
