import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const renderTabs = () =>
    render(
        <Tabs defaultValue="one">
            <TabsList aria-label="Choice">
                <TabsTrigger value="one">One</TabsTrigger>
                <TabsTrigger value="two">Two</TabsTrigger>
            </TabsList>
            <TabsContent value="one">First</TabsContent>
            <TabsContent value="two">Second</TabsContent>
        </Tabs>,
    );

describe("Tabs", () => {
    it("renders a tab list with the selected tab marked", () => {
        renderTabs();

        expect(screen.getByRole("tablist", { name: "Choice" })).toBeInTheDocument();
        expect(screen.getAllByRole("tab")).toHaveLength(2);
        expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "false");
        expect(screen.getByRole("tabpanel")).toHaveTextContent("First");
    });

    it("selects and focuses the next tab with the right arrow key", async () => {
        renderTabs();
        const one = screen.getByRole("tab", { name: "One" });
        one.focus();

        fireEvent.keyDown(one, { key: "ArrowRight" });

        // Radix's roving focus moves focus on the next task.
        const two = screen.getByRole("tab", { name: "Two" });
        await waitFor(() => expect(two).toHaveFocus());
        expect(two).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tabpanel")).toHaveTextContent("Second");
    });
});
