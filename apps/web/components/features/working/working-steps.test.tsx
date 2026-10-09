import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/messages/en.json";
import sample from "@/lib/calc/data/sample_household.json";

import { type WorkingStep, WorkingSteps } from "./working-steps";

function renderSteps(steps: WorkingStep[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkingSteps steps={steps} />
    </NextIntlClientProvider>,
  );
}

describe("WorkingSteps", () => {
  const steps = sample.report.working as WorkingStep[];

  it("renders one item per calc step, in order", () => {
    renderSteps(steps);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(steps.length);
    expect(within(items[0]!).getByText("Step 1")).toBeInTheDocument();
  });

  it("formats money in Indian style and labels inputs in words", () => {
    renderSteps(steps);
    const subsidy = screen.getByRole("heading", { name: "PM Surya Ghar subsidy" }).closest("li")!;
    expect(within(subsidy).getByText("₹60,000")).toBeInTheDocument();
    expect(screen.getAllByText("System size (kW)").length).toBeGreaterThan(0);
  });

  it("marks assumptions and links every source", () => {
    renderSteps(steps);
    expect(screen.getAllByText(/Our assumption/).length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});
