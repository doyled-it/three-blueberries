/**
 * A table of contents that reads the page rather than duplicating it.
 *
 * Built from the h2 of every panel at load, so it cannot drift out of sync when
 * sections are added, renamed or reordered. Nothing to maintain by hand.
 *
 * Two presentations from one list:
 *   Wide screens get a fixed rail beside the content, using space the 980px
 *   column leaves empty anyway.
 *   Narrow screens get a bar pinned to the bottom, which is where a thumb is,
 *   showing the current section and opening the full list on tap.
 *
 * Position tracking uses IntersectionObserver against a band near the top of the
 * viewport rather than scroll maths, so it stays correct when panels change
 * height as the reader edits inputs.
 */

export interface TocEntry {
  id: string;
  label: string;
  element: HTMLElement;
}

/** Short labels: the rail is narrow, and the headings are questions. */
const SHORT_LABELS: Record<string, string> = {
  scenario: "The calculator",
  "what-will-it-actually-cost": "The cost",
  "things-nobody-tells-you": "The gotchas",
  "can-you-buy-it": "Can you buy it",
  "should-you-buy-it": "Should you buy it",
  "what-if-you-wait": "If you wait",
  "why-does-everyone-else-seem-to-manage": "How others manage",
  "why-this-is-so-hard": "Why it's hard",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function buildToc(): TocEntry[] {
  const entries: TocEntry[] = [];
  // The form is a panel too. It has no h2, so it names itself with an attribute,
  // and it has to be reachable: a reader four sections down who wants to change
  // the price should not have to scroll back by hand.
  for (const panel of document.querySelectorAll<HTMLElement>(".panel")) {
    const explicit = panel.dataset["tocLabel"];
    const heading = panel.querySelector("h2");
    if (!explicit && !heading) continue;
    const label = explicit ?? heading!.textContent!.trim();
    const id = panel.id || slugify(label);
    if (!id) continue;
    panel.id = id;
    entries.push({ id, label: SHORT_LABELS[id] ?? label, element: panel });
  }
  return entries;
}

export function renderToc(entries: TocEntry[]): string {
  const items = entries
    .map(
      (e, i) => `
      <li>
        <a href="#${e.id}" data-toc="${e.id}">
          <span class="toc__num">${String(i + 1).padStart(2, "0")}</span>
          <span class="toc__label">${e.label}</span>
        </a>
      </li>`
    )
    .join("");

  return `
<nav class="toc" aria-label="Sections">
  <ol class="toc__list">${items}</ol>
</nav>

<div class="tocbar" hidden>
  <button type="button" class="tocbar__toggle" aria-expanded="false" aria-controls="tocbar-list">
    <span class="tocbar__progress"><i></i></span>
    <span class="tocbar__current">The calculator</span>
    <span class="tocbar__chev" aria-hidden="true">^</span>
  </button>
  <ol class="tocbar__list" id="tocbar-list" hidden>${items}</ol>
</div>`;
}

export function attachToc(entries: TocEntry[]): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-toc]"));
  const current = document.querySelector<HTMLElement>(".tocbar__current");
  const progress = document.querySelector<HTMLElement>(".tocbar__progress i");
  const bar = document.querySelector<HTMLElement>(".tocbar");
  const toggle = document.querySelector<HTMLButtonElement>(".tocbar__toggle");
  const barList = document.querySelector<HTMLElement>(".tocbar__list");

  if (bar) bar.hidden = false;

  const setActive = (id: string) => {
    for (const link of links) {
      const active = link.dataset["toc"] === id;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    const index = entries.findIndex((e) => e.id === id);
    if (current && index > -1) current.textContent = entries[index]!.label;
    if (progress && index > -1) progress.style.width = `${((index + 1) / entries.length) * 100}%`;
  };

  // Track against a band near the top rather than computing scroll offsets, so
  // panels changing height as inputs are edited cannot desynchronise it.
  let visible = new Set<string>();
  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (record.isIntersecting) visible.add(record.target.id);
        else visible.delete(record.target.id);
      }
      const first = entries.find((e) => visible.has(e.id));
      if (first) setActive(first.id);
    },
    { rootMargin: "-12% 0px -70% 0px", threshold: 0 }
  );
  for (const entry of entries) observer.observe(entry.element);

  if (toggle && barList) {
    toggle.addEventListener("click", () => {
      const open = barList.hidden;
      barList.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      bar?.classList.toggle("is-open", open);
    });
    // Choosing a destination should close the sheet.
    for (const link of barList.querySelectorAll("a")) {
      link.addEventListener("click", () => {
        barList.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        bar?.classList.remove("is-open");
      });
    }
  }

  if (entries[0]) setActive(entries[0].id);
}
