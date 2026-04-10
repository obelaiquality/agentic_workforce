import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AspectRatio } from "./aspect-ratio";

describe("AspectRatio", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <AspectRatio ratio={16 / 9}>
        <div>Content</div>
      </AspectRatio>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders children", () => {
    const { container } = render(
      <AspectRatio ratio={16 / 9}>
        <div>Child Content</div>
      </AspectRatio>,
    );
    expect(container.textContent).toContain("Child Content");
  });
});
