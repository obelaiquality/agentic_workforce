import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "./form";

function TestForm() {
  const form = useForm({
    defaultValues: { name: "" },
  });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <input placeholder="Enter name" {...field} />
              </FormControl>
              <FormDescription>Your full name</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

describe("Form", () => {
  it("renders form with label", () => {
    render(<TestForm />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders form description", () => {
    render(<TestForm />);
    expect(screen.getByText("Your full name")).toBeInTheDocument();
  });

  it("renders form control with input", () => {
    render(<TestForm />);
    expect(screen.getByPlaceholderText("Enter name")).toBeInTheDocument();
  });

  it("applies data-slot attributes", () => {
    const { container } = render(<TestForm />);
    expect(container.querySelector('[data-slot="form-item"]')).toBeTruthy();
    expect(
      container.querySelector('[data-slot="form-label"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-slot="form-description"]'),
    ).toBeTruthy();
  });
});
