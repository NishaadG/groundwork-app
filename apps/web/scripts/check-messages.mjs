// Checks hi/mr message files against en: every key present in a translation must
// exist in English, and keep the same {placeholders}, <tags> and ICU plural cases.
// Missing keys are allowed (they fall back to English) but are counted.
import { readFileSync } from "node:fs";

const load = (l) => JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), "utf8"));
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));

// Argument names, rich-text tags and plural selectors, which must survive translation
function shape(s) {
  const args = [...s.matchAll(/\{\s*([a-zA-Z_]\w*)\s*(?:\}|,\s*(plural|select|selectordinal|number|date|time))/g)].map((m) => `${m[1]}:${m[2] ?? ""}`);
  const tags = [...s.matchAll(/<\/?([a-zA-Z]+)>/g)].map((m) => m[0]);
  const cases = [...s.matchAll(/(?:^|[\s}])(=\d+|zero|one|two|few|many|other)\s*\{/g)].map((m) => m[1]);
  return JSON.stringify({ args: [...new Set(args)].sort(), tags: tags.sort(), cases: [...new Set(cases)].sort() });
}

const en = new Map(flat(load("en")));
let failed = false;
for (const lang of ["hi", "mr"]) {
  const tr = new Map(flat(load(lang)));
  const problems = [];
  for (const [k, v] of tr) {
    if (!en.has(k)) problems.push(`${k}: not in en.json`);
    else if (typeof v !== "string") problems.push(`${k}: not a string`);
    else if (shape(v) !== shape(en.get(k))) problems.push(`${k}: ${shape(v)} ≠ en ${shape(en.get(k))}`);
    else if (en.get(k) !== "" && v.trim() === "") problems.push(`${k}: empty`);
  }
  const missing = [...en.keys()].filter((k) => !tr.has(k) && en.get(k) !== "");
  console.log(`${lang}: ${tr.size} keys, ${missing.length} missing (fall back to English), ${problems.length} problems`);
  if (missing.length && process.argv.includes("--list-missing")) console.log(missing.map((k) => `  missing ${k}`).join("\n"));
  for (const p of problems) console.log(`  ${p}`);
  if (problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
