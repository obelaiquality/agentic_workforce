import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ProcessingIndicator } from "./processing-indicator";

describe("ProcessingIndicator", () => {
  it("renders without crashing", () => {
    const { container } = render(<ProcessingIndicator kind="thinking" />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders an img element with correct src", () => {
    const { container } = render(<ProcessingIndicator kind="processing" />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("/assets/helix-progress.svg");
  });

  it("forwards className", () => {
    const { container } = render(
      <ProcessingIndicator kind="thinking" className="custom-class" />,
    );
    expect(container.innerHTML).toContain("custom-class");
  });

  it("sets aria-hidden when no alt provided", () => {
    const { container } = render(<ProcessingIndicator kind="verifying" />);
    expect(container.innerHTML).toContain("aria-hidden");
  });

  it("renders with alt text", () => {
    const { container } = render(
      <ProcessingIndicator kind="routing" alt="Loading" />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Loading");
  });
});
