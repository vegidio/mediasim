import { type ReactNode, StrictMode, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { windowReady } from "@/ipc/window";
import App from "./App";
import "./style.css";

// Not an `as HTMLElement` cast: a missing mount point should say why the window is blank.
const container = document.getElementById("root");

if (!container) {
    throw new Error("#root is missing from index.html; there is nothing to mount into.");
}

/** Reports to Rust that the tree is in the DOM, so the hidden window can be shown. */
const RevealWindow = (): ReactNode => {
    // A mount effect rather than waiting for a paint: a hidden window does not render, so a paint never comes and the
    // window would only appear after Rust's grace period. Effects run on React's commit, which needs no frames.
    useEffect(() => {
        windowReady().catch((error: unknown) => {
            // Expected when the frontend runs in a plain browser (`pnpm dev` opened directly), with no window to show.
            console.error("Failed to report that the window is ready", error);
        });
    }, []);

    // Renders nothing.
    return;
};

ReactDOM.createRoot(container).render(
    <>
        <StrictMode>
            <App />
        </StrictMode>
        {/* Outside StrictMode, whose double-invoked effects would report twice; after App, so it commits with it. */}
        <RevealWindow />
    </>,
);
