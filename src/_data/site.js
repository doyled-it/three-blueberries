/**
 * Site-wide facts, in one place so a URL is never typed twice.
 *
 * Absolute URLs matter here: canonical links, Open Graph images and structured
 * data are all resolved by machines that do not know where the page was served
 * from, so a relative path silently produces a card with no image.
 */

export default {
  url: "https://blueberries.doyled-it.com",
  name: "Three Blueberries",
  // Under 60 characters so search results do not truncate it, and leading with
  // what someone is actually looking for rather than with the brand.
  title: "What a California house actually costs | Three Blueberries",
  description:
    "The real monthly cost of buying a house in California: property tax, Mello-Roos, insurance, PMI, maintenance, all itemised and cited. No lead capture, no email gate.",
  locale: "en_US",
  image: "/assets/og.png",
  imageAlt: "Three Blueberries: what does this house actually cost?",
  author: {
    name: "Michael Doyle",
    url: "https://doyled-it.com",
    support: "https://buymeacoffee.com/doyled.it",
  },
  // Bumped by hand when the content changes materially, not on every deploy.
  updated: "2026-08-04",
  // IndexNow: push a URL to Bing, DuckDuckGo, Yandex and Seznam at once instead
  // of waiting to be crawled. The key is public by design, it is only proof that
  // whoever submits controls the site, which is why the matching file has to be
  // served from the root.
  indexNowKey: "4cf42b4909f18587512bd67f97629c8f",
};
