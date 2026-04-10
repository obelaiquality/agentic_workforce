import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <EmptyState
        icon={<span>Icon</span>}
        heading="No items"
        description="There are no items to display."
      />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders heading and description", () => {
    const { container } = render(
      <EmptyState
        icon={<span>Icon</span>}
        heading="No items"
        description="There are no items to display."
      />,
    );
    expect(container.textContent).toContain("No items");
    expect(container.textContent).toContain("There are no items to display.");
  });

  it("renders action when provided", () => {
    const { container } = render(
      <EmptyState
        icon={<span>Icon</span>}
        heading="No items"
        description="Nothing here"
        action={<button>Add Item</button>}
      />,
    );
    expect(container.textContent).toContain("Add Item");
  });

  it("supports data-testid", () => {
    const { container } = render(
      <EmptyState
        icon={<span>Icon</span>}
        heading="No items"
        description="Nothing here"
        data-testid="empty"
      />,
    );
    expect(container.querySelector('[data-testid="empty"]')).toBeTruthy();
  });
});
