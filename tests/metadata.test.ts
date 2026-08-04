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

test("the footer credits its author and links the source and the tip jar", () => {
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)![0]!;
  assert.match(footer, /Michael Doyle/);
  assert.match(footer, /https:\/\/doyled-it\.com/);
  assert.match(footer, /buymeacoffee\.com\/doyled\.it/);
  assert.match(footer, /github\.com\/doyled-it\/three-blueberries/);
  // Anything opening a new tab needs this, or the new page can reach back.
  assert.match(footer, /rel="noopener"/);

  // The licence is a promise to the reader as much as a legal notice, so it is
  // stated on the page, not only in a file nobody opens.
  assert.match(footer, /AGPL-3\.0/);
  assert.match(footer, /rel="license noopener"/);
});

test("the licence is AGPL everywhere it is declared, and the text is really AGPL", () => {
  // GPL would not have covered this. Almost nobody distributes a web app, they
  // run it on a server, and only AGPL reaches a modified version doing that.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { license: string };
  assert.equal(pkg.license, "AGPL-3.0-only");

  const licence = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
  assert.match(licence, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(licence, /Version 3, 19 November 2007/);
  // Section 13 is the whole reason for choosing it: it is the network clause.
  assert.match(licence, /13\. Remote Network Interaction/);
  assert.ok(licence.split("\n").length > 600, "the full text, not a summary");

  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
  const data = JSON.parse(block) as { "@graph": Array<Record<string, unknown>> };
  const app = data["@graph"].find((n) => n["@type"] === "WebApplication")!;
  assert.match(String(app["license"]), /agpl-3\.0/);
});

test("REGRESSION: the byline is laid out as a sentence, not as flex items", () => {
  // It was a flex container. A flex container makes an anonymous item out of
  // every text run between its element children and applies the gap to each,
  // so "Built by | Michael Doyle | , who wanted" rendered with the comma
  // floating a clear space away from the name.
  const css = fs.readFileSync(path.join(root, "src", "assets", "css", "main.css"), "utf8");
  const rule = css.match(/\.site-footer__credit \{([^}]*)\}/)![1]!;
  assert.ok(!/display:\s*flex/.test(rule), "the sentence must not be a flex container");

  const footer = html.match(/<footer[\s\S]*?<\/footer>/)![0]!;
  // Every direct child of the flex row is an element, so no anonymous items.
  const row = footer.match(/<div class="site-footer__by">([\s\S]*?)<\/div>\s*<\/footer>/)![1]!;
  const stray = row.replace(/<(p|nav)[\s\S]*?<\/\1>/g, "").trim();
  assert.equal(stray, "", `loose text in the flex row would become its own item: ${stray}`);
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

test("robots.txt welcomes the AI crawlers by name, not only by wildcard", () => {
  // Cloudflare's zone-level managed robots.txt prepends a block disallowing
  // these. A wildcard Allow is not enough to argue with a named Disallow, so
  // each one is named. The owner wants the site findable, including by whatever
  // answers the question on someone's behalf.
  const robots = fs.readFileSync(path.join(root, "_site", "robots.txt"), "utf8");
  for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"]) {
    const group = robots.match(new RegExp(`User-agent: ${bot}\\s*\\n(Allow|Disallow): (\\S+)`));
    assert.ok(group, `${bot} is not named in robots.txt`);
    assert.equal(group![1], "Allow", `${bot} is disallowed`);
  }
  assert.ok(!/^Disallow: \/$/m.test(robots), "our own robots.txt must not disallow anything");
  assert.match(robots, /Content-Signal: search=yes/);
});

test("the IndexNow key file is served and matches the key that will be submitted", () => {
  // Submitting with a key whose file does not resolve is rejected, silently
  // enough that it looks like it worked.
  const keyFiles = fs.readdirSync(path.join(root, "_site")).filter((f) => /^[a-f0-9]{16,128}\.txt$/.test(f));
  assert.equal(keyFiles.length, 1, "expected exactly one IndexNow key file at the root");

  const key = keyFiles[0]!.replace(/\.txt$/, "");
  const contents = fs.readFileSync(path.join(root, "_site", keyFiles[0]!), "utf8").trim();
  assert.equal(contents, key, "the file must contain the key and nothing else");
});
