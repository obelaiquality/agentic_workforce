import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "./breadcrumb";

describe("Breadcrumb", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders nav with breadcrumb aria-label", () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(container.querySelector('nav[aria-label="breadcrumb"]')).toBeTruthy();
  });

  it("renders breadcrumb links", () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Page</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(container.textContent).toContain("Home");
    expect(container.textContent).toContain("Page");
  });
});

describe("BreadcrumbEllipsis", () => {
  it("renders without crashing", () => {
    const { container } = render(<BreadcrumbEllipsis />);
    expect(container.firstChild).toBeTruthy();
  });

  it("contains 'More' sr-only text", () => {
    const { container } = render(<BreadcrumbEllipsis />);
    expect(container.textContent).toContain("More");
  });
});
