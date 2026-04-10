import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./collapsible";

describe("Collapsible", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Content</CollapsibleContent>
      </Collapsible>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders trigger text", () => {
    const { container } = render(
      <Collapsible>
        <CollapsibleTrigger>Toggle Me</CollapsibleTrigger>
        <CollapsibleContent>Hidden Content</CollapsibleContent>
      </Collapsible>,
    );
    expect(container.textContent).toContain("Toggle Me");
  });

  it("renders content when open", () => {
    const { container } = render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Visible Content</CollapsibleContent>
      </Collapsible>,
    );
    expect(container.textContent).toContain("Visible Content");
  });
});
