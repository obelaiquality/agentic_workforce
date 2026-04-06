import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageWithFallback } from "./ImageWithFallback";

describe("ImageWithFallback", () => {
  it("renders image with provided src", () => {
    render(<ImageWithFallback src="https://example.com/image.png" alt="Test Image" />);
    const img = screen.getByAltText("Test Image");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/image.png");
  });

  it("applies className to image", () => {
    render(
      <ImageWithFallback
        src="https://example.com/image.png"
        alt="Test"
        className="custom-class"
      />
    );
    const img = screen.getByAltText("Test");
    expect(img).toHaveClass("custom-class");
  });

  it("applies style to image", () => {
    render(
      <ImageWithFallback
        src="https://example.com/image.png"
        alt="Test"
        style={{ width: "100px", height: "100px" }}
      />
    );
    const img = screen.getByAltText("Test");
    expect(img).toHaveStyle({ width: "100px", height: "100px" });
  });

  it("shows fallback when image fails to load", () => {
    render(<ImageWithFallback src="https://example.com/broken.png" alt="Test Image" />);

    const img = screen.getByAltText("Test Image");
    fireEvent.error(img);

    // After error, should show fallback
    const fallback = screen.getByAltText("Error loading image");
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveAttribute("data-original-url", "https://example.com/broken.png");
  });

  it("applies className to fallback container", () => {
    render(
      <ImageWithFallback
        src="https://example.com/broken.png"
        alt="Test"
        className="custom-fallback"
      />
    );

    const img = screen.getByAltText("Test");
    fireEvent.error(img);

    const fallbackContainer = screen.getByAltText("Error loading image").parentElement?.parentElement;
    expect(fallbackContainer).toHaveClass("custom-fallback");
    expect(fallbackContainer).toHaveClass("inline-block");
    expect(fallbackContainer).toHaveClass("bg-gray-100");
  });

  it("applies style to fallback container", () => {
    render(
      <ImageWithFallback
        src="https://example.com/broken.png"
        alt="Test"
        style={{ width: "200px", height: "200px" }}
      />
    );

    const img = screen.getByAltText("Test");
    fireEvent.error(img);

    const fallbackContainer = screen.getByAltText("Error loading image").parentElement?.parentElement;
    expect(fallbackContainer).toHaveStyle({ width: "200px", height: "200px" });
  });

  it("passes additional props to image element", () => {
    render(
      <ImageWithFallback
        src="https://example.com/image.png"
        alt="Test"
        data-testid="test-image"
        loading="lazy"
      />
    );

    const img = screen.getByTestId("test-image");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("stores original URL in fallback", () => {
    render(
      <ImageWithFallback
        src="https://example.com/missing-image.png"
        alt="Test"
      />
    );

    const img = screen.getByAltText("Test");
    fireEvent.error(img);

    const fallbackImg = screen.getByAltText("Error loading image");
    expect(fallbackImg).toHaveAttribute("data-original-url", "https://example.com/missing-image.png");
  });

  it("does not show fallback initially", () => {
    render(
      <ImageWithFallback
        src="https://example.com/image.png"
        alt="Test"
      />
    );

    // Fallback error image should not be present initially
    expect(screen.queryByAltText("Error loading image")).not.toBeInTheDocument();
  });

  it("handles missing alt attribute gracefully", () => {
    render(<ImageWithFallback src="https://example.com/image.png" />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
  });
});
