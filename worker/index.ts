/**
 * Cloudflare Worker: live data, cached hard.
 *
 * Two jobs:
 *   1. Serve the static Eleventy build.
 *   2. Proxy the handful of APIs we need, keeping keys server-side and caching
 *      aggressively in KV.
 *
 * The caching is not an optimization, it's a budget. The listings API we plan to
 * use has a 50-call-per-month free tier, so every uncached request is 2% of the
 * monthly allowance. The cache layer here is built to make that survivable:
 * shared across all visitors, long TTLs, and a stale-rather-than-fail posture.
 */

interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  FRED_API_KEY?: string;
}

/** Freddie Mac's survey publishes Thursday mornings, so a 12h TTL is plenty. */
const RATES_TTL_SECONDS = 12 * 60 * 60;

/**
 * Last known good values, used only if FRED is unreachable AND the cache is
 * cold. Always served with `stale: true` so the UI can say so out loud rather
 * than quietly showing an old number as current.
 */
const RATE_FALLBACK = {
  thirtyYear: 0.0666,
  fifteenYear: 0.0604,
  asOf: "2026-07-30",
};

interface RatesPayload {
  thirtyYear: number;
  fifteenYear: number | null;
  asOf: string;
  stale: boolean;
  source: { title: string; url: string; publisher: string };
}

const RATE_SOURCE = {
  title: "Primary Mortgage Market Survey (MORTGAGE30US / MORTGAGE15US)",
  publisher: "Freddie Mac, via FRED",
  url: "https://fred.stlouisfed.org/series/MORTGAGE30US",
};

function json(body: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
    },
  });
}

/** Pulls the most recent non-missing observation from a FRED series. */
async function fetchFredSeries(seriesId: string, apiKey: string): Promise<{ value: number; date: string } | null> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "8");

  const res = await fetch(url.toString(), { cf: { cacheTtl: 3600 } });
  if (!res.ok) return null;

  const data = (await res.json()) as { observations?: Array<{ date: string; value: string }> };
  for (const obs of data.observations ?? []) {
    const value = Number(obs.value);
    if (Number.isFinite(value)) return { value, date: obs.date };
  }
  return null;
}

async function getRates(env: Env): Promise<RatesPayload> {
  // The cache is an optimisation and a budget guard, never a dependency. If the
  // binding is missing or KV is having a bad day, we still answer, we just pay
  // for it upstream. Letting this throw would take out the whole endpoint over
  // a cache miss.
  let cached: RatesPayload | null = null;
  try {
    cached = await env.CACHE.get<RatesPayload>("rates:v1", "json");
  } catch {
    cached = null;
  }
  if (cached) return cached;

  if (!env.FRED_API_KEY) {
    return { ...RATE_FALLBACK, fifteenYear: RATE_FALLBACK.fifteenYear, stale: true, source: RATE_SOURCE };
  }

  try {
    const [thirty, fifteen] = await Promise.all([
      fetchFredSeries("MORTGAGE30US", env.FRED_API_KEY),
      fetchFredSeries("MORTGAGE15US", env.FRED_API_KEY),
    ]);

    if (!thirty) throw new Error("FRED returned no usable 30-year observation");

    const payload: RatesPayload = {
      // FRED reports percent; the engine wants a decimal.
      thirtyYear: thirty.value / 100,
      fifteenYear: fifteen ? fifteen.value / 100 : null,
      asOf: thirty.date,
      stale: false,
      source: RATE_SOURCE,
    };

    try {
      await env.CACHE.put("rates:v1", JSON.stringify(payload), { expirationTtl: RATES_TTL_SECONDS });
    } catch {
      // Answer with fresh data even if we could not store it.
    }
    return payload;
  } catch {
    return { ...RATE_FALLBACK, fifteenYear: RATE_FALLBACK.fifteenYear, stale: true, source: RATE_SOURCE };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rates") {
      const rates = await getRates(env);
      // Let the browser hold it briefly too. No reason to re-ask on every nav.
      return json(rates, 200, 900);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
