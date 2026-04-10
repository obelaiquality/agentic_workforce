import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
  TableCaption,
} from "./table";

describe("Table", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Table className="custom-class">
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });
});

describe("TableHeader", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    expect(container.querySelector("thead")).toBeTruthy();
  });
});

describe("TableBody", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(container.querySelector("tbody")).toBeTruthy();
  });
});

describe("TableFooter", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Table>
        <TableFooter>
          <TableRow>
            <TableCell>Footer</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    expect(container.querySelector("tfoot")).toBeTruthy();
  });
});

describe("TableCaption", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Table>
        <TableCaption>Caption text</TableCaption>
      </Table>,
    );
    expect(container.textContent).toContain("Caption text");
  });
});
