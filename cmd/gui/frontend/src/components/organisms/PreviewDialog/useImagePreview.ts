import { useEffect, useState } from 'react';
import { GetDimensions } from '@bindings/gui/services/thumbnailservice.js';

export const useImagePreview = (path?: string, isVideo?: boolean) => {
    const [fullSizeUrl, setFullSizeUrl] = useState<string>();
    const [fullSizeDims, setFullSizeDims] = useState<{ width: number; height: number }>();

    useEffect(() => {
        setFullSizeUrl(undefined);
        setFullSizeDims(undefined);

        if (!path || isVideo) return;

        const url = `/thumb?path=${encodeURIComponent(path)}&maxSize=0`;
        setFullSizeUrl(url);

        const promise = GetDimensions(path);
        promise.then(([width, height]) => setFullSizeDims({ width, height }));

        return () => {
            promise.cancel();
        };
    }, [path, isVideo]);

    return { fullSizeUrl, fullSizeDims };
};
