import { describe, expect, it } from "vitest";

import { formatInr, formatLakh, formatNumber } from "./format";

describe("Indian number formatting", () => {
  it("groups money in lakhs", () => {
    expect(formatInr(123456)).toBe("₹1,23,456");
    expect(formatInr(1234567.891, "en", { decimals: 2 })).toBe("₹12,34,567.89");
  });
  it("keeps Latin digits in Hindi and Marathi", () => {
    expect(formatNumber(123456, "hi")).toBe("1,23,456");
    expect(formatNumber(123456, "mr")).toBe("1,23,456");
  });
  it("writes lakh and crore", () => {
    expect(formatLakh(215000)).toBe("2.15 lakh");
    expect(formatLakh(31500000)).toBe("3.15 crore");
    expect(formatLakh(78000)).toBe("78,000");
  });
});
