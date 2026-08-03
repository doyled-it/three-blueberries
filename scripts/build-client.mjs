/**
 * Bundles the TypeScript engine for the browser.
 *
 * The whole calculator runs client-side — no round trip, no server holding your
 * income. The only thing the worker is for is fetching live rates.
 */

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [path.join(root, "src", "client", "app.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: path.join(root, "src", "assets", "js", "app.js"),
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
};

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching client bundle...");
} else {
  await build(options);
}
