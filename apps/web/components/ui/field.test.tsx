import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, Input } from "./field";

describe("Field", () => {
  it("links label, hint and error to the control", () => {
    render(
      <Field id="units" label="Units consumed" hint="Next to 'Units consumed' on your bill" error="Enter a number">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Units consumed");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Next to 'Units consumed' on your bill Enter a number");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number");
  });
});
