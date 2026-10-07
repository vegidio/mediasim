import type { ComponentProps } from "react";
import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";

const Dialog = ({ ...props }: ComponentProps<typeof DialogPrimitive.Root>) => {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
};

const DialogTrigger = ({ ...props }: ComponentProps<typeof DialogPrimitive.Trigger>) => {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
};

const DialogPortal = ({ ...props }: ComponentProps<typeof DialogPrimitive.Portal>) => {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
};

const DialogClose = ({ ...props }: ComponentProps<typeof DialogPrimitive.Close>) => {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
};

const DialogOverlay = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) => {
    return (
        <DialogPrimitive.Overlay
            data-slot="dialog-overlay"
            className={cn(
                "fixed inset-0 z-50 bg-black/70 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
                className,
            )}
            {...props}
        />
    );
};

/** The dialog's box, centred in the overlay by flex, so a box sized by its content needs no transform. */
const DialogContent = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) => {
    return (
        <DialogPortal>
            <DialogOverlay className="flex items-center justify-center">
                <DialogPrimitive.Content
                    data-slot="dialog-content"
                    className={cn(
                        "relative bg-popover text-popover-foreground outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                        className,
                    )}
                    {...props}
                />
            </DialogOverlay>
        </DialogPortal>
    );
};

const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            className={cn("font-heading text-base font-medium", className)}
            {...props}
        />
    );
};

const DialogDescription = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) => {
    return (
        <DialogPrimitive.Description
            data-slot="dialog-description"
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
};

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger,
};
