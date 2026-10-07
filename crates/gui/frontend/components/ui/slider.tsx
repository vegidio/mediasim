"use client";

import type { ComponentProps } from "react";
import { cn } from "cn";
import { Slider as SliderPrimitive } from "radix-ui";

const Slider = ({
    className,
    trackClassName,
    rangeClassName,
    thumbClassName,
    min = 0,
    max = 100,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    ...props
}: ComponentProps<typeof SliderPrimitive.Root> & {
    trackClassName?: string;
    rangeClassName?: string;
    thumbClassName?: string;
}) => {
    const { value, defaultValue } = props;
    const _values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max];

    return (
        <SliderPrimitive.Root
            data-slot="slider"
            min={min}
            max={max}
            className={cn(
                "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
                className,
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                className={cn(
                    "relative grow overflow-hidden rounded-full bg-muted data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1",
                    trackClassName,
                )}
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    className={cn("absolute bg-primary data-horizontal:h-full data-vertical:w-full", rangeClassName)}
                />
            </SliderPrimitive.Track>
            {Array.from({ length: _values.length }, (_, index) => (
                <SliderPrimitive.Thumb
                    data-slot="slider-thumb"
                    // biome-ignore lint/suspicious/noArrayIndexKey: a thumb is identified by its position alone.
                    key={index}
                    // The thumb is what carries `role="slider"`, so it takes the accessible name and description.
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                    aria-describedby={ariaDescribedBy}
                    className={cn(
                        "relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50",
                        thumbClassName,
                    )}
                />
            ))}
        </SliderPrimitive.Root>
    );
};

export { Slider };
