import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The metadata is invisible on the page, which is exactly why it rots. Nobody
 * notices a broken og:image until a link has already been pasted somewhere.
 *
 * These read the BUILT output, not the template, so a Nunjucks variable that
 * silently resolves to an empty string fails here rather than shipping.
 */

const root = new URL("../", import.meta.url).pathname;
const built = path.join(root, "_site", "index.html");

if (!fs.existsSync(built)) {
  test("the site has been built", () => {
    assert.fail("run `npm run build` before the tests, these assert on _site/");
  });
}

const html = fs.existsSync(built) ? fs.readFileSync(built, "utf8") : "";
const head = html.slice(0, html.indexOf("</head>"));

const meta = (attr: "name" | "property", key: string): string | null => {
  const match = head.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return match ? match[1]! : null;
};

const SITE = "https://blueberries.doyled-it.com";

test("the title and description are present, sized for a search result", () => {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)![1]!.trim();
  assert.ok(title.length > 20, "a title this short says nothing");
  assert.ok(title.length <= 65, `${title.length} characters will be truncated in a result`);

  const description = meta("name", "description")!;
  assert.ok(description, "no description");
  assert.ok(description.length >= 70, "too short to earn the space it gets");
  assert.ok(description.length <= 175, `${description.length} characters will be cut off`);

  // The thing a person actually searches for has to appear in both.
  assert.match(title, /California/i);
  assert.match(description, /California/i);
});

test("canonical and Open Graph URLs are absolute and point at the live site", () => {
  const canonical = head.match(/<link rel="canonical" href="([^"]+)"/)![1]!;
  assert.equal(canonical, `${SITE}/`);
  assert.equal(meta("property", "og:url"), `${SITE}/`);

  for (const key of ["og:image", "twitter:image"] as const) {
    const value = key.startsWith("og:") ? meta("property", key) : meta("name", key);
    assert.ok(value?.startsWith("https://"), `${key} must be absolute, got ${value}`);
  }
});

test("REGRESSION: the social card image actually exists at the URL claimed", () => {
  // A card pointing at a 404 renders as a bare link, which is worse than having
  // no card at all because it looks broken rather than plain.
  const url = meta("property", "og:image")!;
  const file = path.join(root, "_site", url.slice(SITE.length));
  assert.ok(fs.existsSync(file), `og:image points at ${url}, which is not in the build`);

  const bytes = fs.statSync(file).size;
  assert.ok(bytes > 5_000, "suspiciously small for a 1200x630 card");
  assert.ok(bytes < 1_000_000, "too large; some platforms refuse to fetch it");

  // Dimensions are declared, and the declaration has to be true.
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
  const png = fs.readFileSync(file);
  assert.equal(png.readUInt32BE(16), 1200, "the PNG is not actually 1200 wide");
  assert.equal(png.readUInt32BE(20), 630, "the PNG is not actually 630 tall");
});

test("the card has everything a platform needs to render it", () => {
  assert.equal(meta("property", "og:type"), "website");
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  for (const key of ["og:title", "og:description", "og:site_name", "og:image:alt"] as const) {
    assert.ok(meta("property", key), `missing ${key}`);
  }
  assert.ok(meta("property", "og:image:alt")!.length > 10, "alt text is for people, not for crawlers");
});

test("the structured data parses and names a real author", () => {
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
  const data = JSON.parse(block) as { "@graph": Array<Record<string, unknown>> };

  const types = data["@graph"].map((n) => n["@type"]);
  assert.ok(types.includes("WebApplication"));
  assert.ok(types.includes("Person"));

  const person = data["@graph"].find((n) => n["@type"] === "Person")!;
  assert.equal(person["name"], "Michael Doyle");
  assert.equal(person["url"], "https://doyled-it.com");

  const app = data["@graph"].find((n) => n["@type"] === "WebApplication")!;
  assert.equal(app["isAccessibleForFree"], true);
  // If this ever stops being true, the schema is a lie before the page is.
  assert.equal((app["offers"] as Record<string, unknown>)["price"], "0");
});

test("the footer credits its author and links the tip jar", () => {
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)![0]!;
  assert.match(footer, /Michael Doyle/);
  assert.match(footer, /https:\/\/doyled-it\.com/);
  assert.match(footer, /buymeacoffee\.com\/doyled\.it/);
  // Anything opening a new tab needs this, or the new page can reach back.
  assert.match(footer, /rel="noopener"/);
});

test("robots.txt and the sitemap are built and agree with each other", () => {
  const robots = fs.readFileSync(path.join(root, "_site", "robots.txt"), "utf8");
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, new RegExp(`Sitemap: ${SITE}/sitemap\\.xml`));

  const sitemap = fs.readFileSync(path.join(root, "_site", "sitemap.xml"), "utf8");
  assert.match(sitemap, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(sitemap, new RegExp(`<loc>${SITE}/</loc>`));
  // Every URL the sitemap claims must exist in the build.
  for (const loc of [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)) {
    const rel = loc.slice(SITE.length);
    const file = path.join(root, "_site", rel === "/" ? "index.html" : rel);
    assert.ok(fs.existsSync(file), `sitemap lists ${loc}, which is not in the build`);
  }
});

test("the page is still readable with JavaScript switched off", () => {
  // The numbers are computed client-side, which is fine, but a crawler landing
  // on an empty shell would index nothing. The prose and the headings ship in
  // the HTML itself.
  const body = html.slice(html.indexOf("<body"));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  assert.ok(text.length > 4_000, `only ${text.length} characters of static text`);
  assert.match(text, /Mello-Roos/);
  assert.match(text, /supplemental property tax/i);

  const headings = [...body.matchAll(/<h([12])[^>]*>/g)].map((m) => m[1]);
  assert.equal(headings.filter((h) => h === "1").length, 1, "exactly one h1");
  assert.ok(headings.filter((h) => h === "2").length >= 6, "the sections need real headings");
});
