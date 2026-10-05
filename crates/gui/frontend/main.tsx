import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

// Not an `as HTMLElement` cast: a missing mount point should say why the window is blank.
const container = document.getElementById("root");

if (!container) {
    throw new Error("#root is missing from index.html; there is nothing to mount into.");
}

ReactDOM.createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
