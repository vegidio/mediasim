import { useEffect, useState } from 'react';
import { GetImage } from '@bindings/gui/services/mediaservice.js';
import { toDataUrl } from '@/utils/image';
import { getCachedPreview, setCachedPreview } from '@/utils/previewCache';

export const useImagePreview = (path?: string, isVideo?: boolean) => {
    const [fullSizeUrl, setFullSizeUrl] = useState<string>();
    const [fullSizeDims, setFullSizeDims] = useState<{ width: number; height: number }>();

    useEffect(() => {
        setFullSizeUrl(undefined);
        setFullSizeDims(undefined);

        if (!path || isVideo) return;

        const cached = getCachedPreview(path);

        if (cached) {
            setFullSizeUrl(cached.dataUrl);
            setFullSizeDims({ width: cached.width, height: cached.height });
            return;
        }

        const promise = GetImage(path, 0);

        promise.then(([data, width, height]) => {
            const dataUrl = toDataUrl(data);
            setFullSizeUrl(dataUrl);
            setFullSizeDims({ width, height });
            setCachedPreview(path, { dataUrl, width, height });
        });

        return () => {
            promise.cancel();
        };
    }, [path, isVideo]);

    return { fullSizeUrl, fullSizeDims };
};
