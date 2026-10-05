import { describe, expect, it, vi } from "vitest";
import { windowReady } from "@/ipc/window";

vi.mock("@/ipc/window", () => ({ windowReady: vi.fn(() => Promise.resolve()) }));
vi.mock("./App", () => ({ default: () => <p>app</p> }));

describe("main.tsx", () => {
    it("reports the window ready once, after mounting the app", async () => {
        document.body.innerHTML = '<div id="root"></div>';

        await import("./main");

        await vi.waitFor(() => expect(document.body).toHaveTextContent("app"));
        // Past anything a second, StrictMode-style effect run would have queued.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(windowReady).toHaveBeenCalledOnce();
    });
});
