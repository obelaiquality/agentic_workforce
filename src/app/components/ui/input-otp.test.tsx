import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "./input-otp";

beforeEach(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

describe("InputOTP", () => {
  it("renders InputOTP with groups and slots", () => {
    const { container } = render(
      <InputOTP maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(container.querySelector('[data-slot="input-otp"]')).toBeTruthy();
  });

  it("renders InputOTPGroup", () => {
    const { container } = render(
      <InputOTP maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(
      container.querySelector('[data-slot="input-otp-group"]'),
    ).toBeTruthy();
  });

  it("renders InputOTPSeparator", () => {
    render(
      <InputOTP maxLength={6}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
