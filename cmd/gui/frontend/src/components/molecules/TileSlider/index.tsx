import { useState } from 'react';
import { IconButton, Slider } from '@mui/material';
import { Icon } from '@/components/atoms';
import { TILE_SLIDER_MAX_SIZE, TILE_SLIDER_MIN_SIZE, TILE_WIDTH } from '@/utils/constants';

export const TileSlider = () => {
    const [size, setSize] = useState(TILE_SLIDER_MIN_SIZE);

    const handleTileChange = (_: Event, value: number | number[]) => {
        setSize(value as number);
    };

    const handleZoomIn = () => {
        setSize((prev) => Math.min(prev + 10, TILE_SLIDER_MAX_SIZE));
    };

    const handleZoomOut = () => {
        setSize((prev) => Math.max(prev - 10, TILE_SLIDER_MIN_SIZE));
    };

    return (
        <div className='flex items-center gap-1'>
            <IconButton color='inherit' size='small' disableRipple onClick={handleZoomOut}>
                <Icon name='zoom-out' />
            </IconButton>

            <Slider
                className='w-24'
                size='small'
                min={TILE_WIDTH}
                max={TILE_SLIDER_MAX_SIZE}
                step={10}
                value={size}
                onChange={handleTileChange}
                valueLabelDisplay='auto'
                valueLabelFormat={(value) => `${value} px`}
                slotProps={{ thumb: { style: { boxShadow: 'none' } } }}
            />

            <IconButton color='inherit' size='small' disableRipple onClick={handleZoomIn}>
                <Icon name='zoom-in' />
            </IconButton>
        </div>
    );
};
