/**
 * Scenario in the URL, so any setup is a link you can send or bookmark.
 *
 * This fits the project's ethos rather than fighting it: the state lives in the
 * URL, nothing is sent to a server, there is no account and no storage. Sharing
 * a link is the reader's own choice, and opening one fetches nothing.
 *
 * Only the CORE scenario travels: the house, the loan, and your finances. The
 * exploratory sliders in the analysis panels (appreciation, the crash model,
 * the cohort year) are left at their defaults on a shared link, so a URL stays
 * short and the recipient explores from the same starting point. And only
 * fields that DIFFER from the default are written, so a fresh page keeps a clean
 * URL and a shared one carries only what was actually changed.
 */

type FieldKind = "money" | "number" | "select" | "checkbox";

interface Field {
  id: string;
  /** Short, stable URL key. Renaming one breaks old links, so don't. */
  key: string;
  kind: FieldKind;
}

// The core scenario. Order is irrelevant; keys are what old links depend on.
const FIELDS: Field[] = [
  { id: "purchasePrice", key: "p", kind: "money" },
  { id: "downPaymentAmount", key: "d", kind: "money" },
  { id: "loanType", key: "loan", kind: "select" },
  { id: "termYears", key: "term", kind: "select" },
  { id: "interestRate", key: "rate", kind: "number" },
  { id: "creditScore", key: "fico", kind: "number" },
  { id: "county", key: "county", kind: "select" },
  { id: "squareFeet", key: "sqft", kind: "money" },
  { id: "hoaMonthly", key: "hoa", kind: "money" },
  { id: "melloRoosAnnual", key: "mello", kind: "money" },
  { id: "income1", key: "inc", kind: "money" },
  { id: "income2", key: "inc2", kind: "money" },
  { id: "monthlyDebts", key: "debt", kind: "money" },
  { id: "householdSize", key: "size", kind: "number" },
  { id: "currentRent", key: "rent", kind: "money" },
  { id: "currentSavings", key: "saved", kind: "money" },
  { id: "monthlySavings", key: "save", kind: "money" },
  { id: "rentalIncome", key: "unit", kind: "money" },
  { id: "insuranceAnnual", key: "ins", kind: "money" },
  { id: "propertyTaxRate", key: "taxr", kind: "number" },
  { id: "excludeRental", key: "norent", kind: "checkbox" },
  { id: "homeownersExemption", key: "exempt", kind: "checkbox" },
  { id: "vaFirstUse", key: "vafirst", kind: "checkbox" },
  { id: "vaDisabilityExempt", key: "vadis", kind: "checkbox" },
];

/** Exposed for tests: every field id must exist in the page and keys be unique. */
export const PERMALINK_FIELDS: ReadonlyArray<{ id: string; key: string }> = FIELDS.map((f) => ({ id: f.id, key: f.key }));

const el = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
const digits = (s: string) => s.replace(/[^\d.]/g, "");

/** The HTML defaults, captured once so a URL only needs to carry the changes. */
let defaults: Record<string, string> | null = null;

function snapshotDefaults(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const node = el(f.id);
    if (!node) continue;
    out[f.id] = f.kind === "checkbox" ? String((node as HTMLInputElement).checked) : node.value;
  }
  return out;
}

/**
 * Apply a shared URL to the form, before the first render. Returns true if any
 * field was set, so the caller knows the rate field was user-supplied and the
 * live feed should not overwrite it.
 */
export function applyScenarioFromUrl(): boolean {
  defaults ??= snapshotDefaults();
  const params = new URLSearchParams(location.search);
  if ([...params.keys()].length === 0) return false;

  let applied = false;
  for (const f of FIELDS) {
    if (!params.has(f.key)) continue;
    const node = el(f.id);
    if (!node) continue;
    const raw = params.get(f.key)!;

    if (f.kind === "checkbox") {
      (node as HTMLInputElement).checked = raw === "1" || raw === "true";
    } else if (f.kind === "money") {
      const n = Number(digits(raw));
      if (Number.isFinite(n)) node.value = n.toLocaleString("en-US");
    } else if (f.kind === "select") {
      // Only accept a value the select actually offers. A <select> already
      // coerces an unknown value to "", but validating against the real options
      // keeps a crafted URL from ever putting an off-list string in play (the
      // county then flows into the print report's markup).
      const select = node as HTMLSelectElement;
      if (![...select.options].some((o) => o.value === raw)) continue;
      select.value = raw;
    } else {
      node.value = raw;
    }
    applied = true;
  }
  return applied;
}

/** Serialise the current form to the URL, writing only what differs from default. */
export function writeScenarioToUrl(): void {
  defaults ??= snapshotDefaults();
  const params = new URLSearchParams();
  for (const f of FIELDS) {
    const node = el(f.id);
    if (!node) continue;
    const current = f.kind === "checkbox" ? String((node as HTMLInputElement).checked) : node.value;
    if (current === defaults[f.id]) continue;

    if (f.kind === "checkbox") {
      params.set(f.key, current === "true" ? "1" : "0");
    } else if (f.kind === "money") {
      params.set(f.key, digits(current) || "0");
    } else {
      params.set(f.key, current);
    }
  }
  const qs = params.toString();
  // replaceState, not pushState: typing should not fill the back button.
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}
