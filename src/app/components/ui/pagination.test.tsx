import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "./pagination";

describe("Pagination", () => {
  it("renders Pagination as a nav", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink href="#">1</PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders PaginationPrevious and PaginationNext", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#" />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    expect(
      screen.getByLabelText("Go to previous page"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Go to next page")).toBeInTheDocument();
  });

  it("renders PaginationEllipsis", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    expect(screen.getByText("More pages")).toBeInTheDocument();
  });

  it("marks active PaginationLink", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink href="#" isActive>
              2
            </PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    const link = screen.getByText("2");
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});
