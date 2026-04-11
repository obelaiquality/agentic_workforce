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

  it("applies custom className to InputOTPGroup", () => {
    const { container } = render(
      <InputOTP maxLength={4}>
        <InputOTPGroup className="custom-group">
          <InputOTPSlot index={0} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(container.querySelector(".custom-group")).toBeTruthy();
  });

  it("applies custom className to InputOTPSlot", () => {
    const { container } = render(
      <InputOTP maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} className="custom-slot" />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(container.querySelector(".custom-slot")).toBeTruthy();
  });

  it("applies custom containerClassName to InputOTP", () => {
    const { container } = render(
      <InputOTP maxLength={4} containerClassName="custom-container">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(container.querySelector(".custom-container")).toBeTruthy();
  });

  it("renders InputOTPSlot with data-slot attribute", () => {
    const { container } = render(
      <InputOTP maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(
      container.querySelector('[data-slot="input-otp-slot"]'),
    ).toBeTruthy();
  });

  it("renders InputOTPSeparator with data-slot attribute", () => {
    const { container } = render(
      <InputOTP maxLength={6}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
        <InputOTPSeparator data-testid="sep" />
        <InputOTPGroup>
          <InputOTPSlot index={1} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(
      container.querySelector('[data-slot="input-otp-separator"]'),
    ).toBeTruthy();
  });

  it("applies disabled styling via className", () => {
    const { container } = render(
      <InputOTP maxLength={4} disabled className="my-disabled-class">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
        </InputOTPGroup>
      </InputOTP>,
    );
    expect(container.querySelector('[data-slot="input-otp"]')).toBeTruthy();
  });
});
