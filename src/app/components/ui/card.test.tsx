import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "./card";

describe("Card", () => {
  it("renders without crashing", () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstChild).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(<Card className="custom-class">Content</Card>);
    expect(container.innerHTML).toContain("custom-class");
  });
});

describe("CardHeader", () => {
  it("renders without crashing", () => {
    const { container } = render(<CardHeader>Header</CardHeader>);
    expect(container.firstChild).toBeTruthy();
  });
});

describe("CardTitle", () => {
  it("renders without crashing", () => {
    const { container } = render(<CardTitle>Title</CardTitle>);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders children", () => {
    const { container } = render(<CardTitle>My Title</CardTitle>);
    expect(container.textContent).toBe("My Title");
  });
});

describe("CardDescription", () => {
  it("renders without crashing", () => {
    const { container } = render(<CardDescription>Desc</CardDescription>);
    expect(container.firstChild).toBeTruthy();
  });
});

describe("CardAction", () => {
  it("renders without crashing", () => {
    const { container } = render(<CardAction>Action</CardAction>);
    expect(container.firstChild).toBeTruthy();
  });
});

describe("CardContent", () => {
  it("renders without crashing", () => {
    const { container } = render(<CardContent>Content</CardContent>);
    expect(container.firstChild).toBeTruthy();
  });
});

describe("CardFooter", () => {
  it("renders without crashing", () => {
    const { container } = render(<CardFooter>Footer</CardFooter>);
    expect(container.firstChild).toBeTruthy();
  });
});
