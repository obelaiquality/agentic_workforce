import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Avatar, AvatarImage, AvatarFallback } from "./avatar";

describe("Avatar", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("forwards className", () => {
    const { container } = render(
      <Avatar className="custom-class">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(container.innerHTML).toContain("custom-class");
  });

  it("renders fallback text", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(container.textContent).toContain("AB");
  });
});

describe("AvatarImage", () => {
  it("renders without crashing inside Avatar", () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/avatar.png" alt="User" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
