import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Alert, AlertTitle, AlertDescription } from "./alert";

describe("Alert", () => {
  it("renders without crashing", () => {
    const { container } = render(<Alert>Alert content</Alert>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders with alert role", () => {
    const { container } = render(<Alert>Alert content</Alert>);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Alert className="custom-class">Alert content</Alert>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });
});

describe("AlertTitle", () => {
  it("renders without crashing", () => {
    const { container } = render(<AlertTitle>Title</AlertTitle>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders children", () => {
    const { container } = render(<AlertTitle>My Title</AlertTitle>);
    expect(container.textContent).toBe("My Title");
  });
});

describe("AlertDescription", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <AlertDescription>Description</AlertDescription>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders children", () => {
    const { container } = render(
      <AlertDescription>My Description</AlertDescription>,
    );
    expect(container.textContent).toBe("My Description");
  });
});
