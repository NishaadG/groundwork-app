/**
 * Number formatting: money via Intl en-IN (₹1,23,456),
 * Latin digits in every locale unless the user opts into Devanagari digits.
 */
const NUMBERING = "latn";

function locale(lang: string): string {
  return `${lang === "en" ? "en" : lang}-IN-u-nu-${NUMBERING}`;
}

export function formatInr(value: number, lang = "en", opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? 0;
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number, lang = "en", decimals = 0): string {
  return new Intl.NumberFormat(locale(lang), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Lakh/crore wording for copy, e.g. 215000 → "2.15 lakh" (English only). */
export function formatLakh(value: number): string {
  if (value >= 1e7) return `${formatNumber(value / 1e7, "en", 2)} crore`;
  if (value >= 1e5) return `${formatNumber(value / 1e5, "en", 2)} lakh`;
  return formatNumber(value);
}
