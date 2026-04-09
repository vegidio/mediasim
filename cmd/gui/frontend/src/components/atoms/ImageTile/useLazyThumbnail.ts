import { type RefObject, useEffect } from 'react';
import { GetImage } from '@bindings/gui/services/mediaservice.js';
import { useAppStore, useImagesStore } from '@/stores';
import { toDataUrl } from '@/utils/image';
import { acquireSlot, releaseSlot } from '@/utils/throttle';
import { getCachedThumbnail } from '@/utils/thumbnailCache';

export const useLazyThumbnail = (
    ref: RefObject<HTMLDivElement | null>,
    path: string,
    status: 'idle' | 'loading' | 'loaded',
) => {
    const tileSize = useAppStore((s) => s.tileSize);
    const setLoading = useImagesStore((s) => s.setLoading);
    const setThumbnailLoaded = useImagesStore((s) => s.setThumbnailLoaded);

    useEffect(() => {
        if (!ref.current || status !== 'idle') return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();

                    acquireSlot().then(() => {
                        setLoading(path);

                        GetImage(path, tileSize)
                            .then(([data, w, h]) => setThumbnailLoaded(path, toDataUrl(data), w, h))
                            .finally(releaseSlot);
                    });
                }
            },
            { threshold: 0.1 },
        );

        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [path, status, tileSize, setLoading, setThumbnailLoaded, ref.current]);

    return status === 'loaded' ? getCachedThumbnail(path) : undefined;
};
