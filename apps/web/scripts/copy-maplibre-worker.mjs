// MapLibre 6 loads its web worker as a file next to its own module. Once Next bundles
// MapLibre, that file isn't there, so we serve the worker (and the shared module it
// imports) from /maplibre/ and point MapLibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(dist, f), join(out, f));
console.log("copied MapLibre worker to public/maplibre");
