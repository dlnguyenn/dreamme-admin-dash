/**
 * Load Apple's "App Downloads Detailed" report into asc_downloads_daily
 * (migration 0101), for the MMP tab's App Store check.
 *
 * Unlike the Installation and Deletion reports (opt-in devices only, ~3.5x
 * undercount), this COMMERCE report counts every download. It splits them by
 * download type, source type (search, browse, app referrer, web) and, for app
 * referrers, the referring app (com.facebook.Facebook, com.burbn.instagram).
 *
 * Runs locally: it signs App Store Connect API calls with the .p8 key, which
 * is not on Vercel. Apple posts each day's file about a day later.
 *
 *   npm run asc:downloads            # last 40 days
 *   npm run asc:downloads -- 90      # last 90 days
 *
 * Env: ASC_P8_PATH (default: the key in DreamMe/p8 keys), plus the usual
 * NEXT_PUBLIC_SUPABASE_URL and DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY from
 * .env.local.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const KEY_ID = "8S87YTYD6X";
const ISSUER_ID = "fa14c678-37f6-4402-bd75-e9d2f3c7051a";
const P8_PATH = process.env.ASC_P8_PATH ?? "C:/Users/Dan/Documents/DreamMe/p8 keys/AuthKey_8S87YTYD6X.p8";
// "App Downloads Detailed" on the ONGOING analytics request 1b756963-...
const REPORT_ID = "r4-1b756963-25f5-4bf8-aecb-5c470299ec76";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

function jwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("SHA256", Buffer.from(`${head}.${body}`), { key: fs.readFileSync(P8_PATH, "utf8"), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

const TOKEN = jwt();

async function asc<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.appstoreconnect.apple.com${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`ASC ${res.status} ${url}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

type Page<T> = { data: T[]; links?: { next?: string } };
type Instance = { id: string; attributes: { processingDate: string; granularity: string } };
type Segment = { attributes: { url: string } };

export function aggregateTsv(tsv: string): Map<string, number> {
  const [header, ...lines] = tsv.split(/\r?\n/).filter(Boolean);
  const cols = header.split("\t");
  const at = (name: string) => cols.indexOf(name);
  const [iDate, iType, iSource, iInfo, iCount] = ["Date", "Download Type", "Source Type", "Source Info", "Counts"].map(at);
  const out = new Map<string, number>();
  for (const line of lines) {
    const f = line.split("\t");
    const key = [f[iDate], f[iType], f[iSource], f[iInfo] ?? ""].join("\u0001");
    out.set(key, (out.get(key) ?? 0) + (Number(f[iCount]) || 0));
  }
  return out;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("NEXT_PUBLIC_SUPABASE_URL / DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY missing");
  const days = Number(process.argv[2] ?? 40);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const instances: Instance[] = [];
  let next: string | undefined = `/v1/analyticsReports/${REPORT_ID}/instances?filter[granularity]=DAILY&limit=200`;
  while (next) {
    const page: Page<Instance> = await asc<Page<Instance>>(next);
    instances.push(...page.data);
    next = page.links?.next;
  }
  const wanted = instances.filter((i) => i.attributes.processingDate >= since);
  console.log(`${instances.length} daily files on Apple's side, ${wanted.length} since ${since}`);

  const totals = new Map<string, number>();
  for (const inst of wanted) {
    const segs = await asc<Page<Segment>>(`/v1/analyticsReportInstances/${inst.id}/segments`);
    for (const s of segs.data) {
      const gz = Buffer.from(await (await fetch(s.attributes.url)).arrayBuffer());
      for (const [k, v] of aggregateTsv(zlib.gunzipSync(gz).toString("utf8"))) totals.set(k, (totals.get(k) ?? 0) + v);
    }
  }

  const syncedAt = new Date().toISOString();
  const rows = [...totals].map(([k, counts]) => {
    const [date, download_type, source_type, source_app] = k.split("\u0001");
    return { date, download_type, source_type, source_app, counts, synced_at: syncedAt };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/asc_downloads_daily?on_conflict=date,download_type,source_type,source_app`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
  }
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  console.log(`upserted ${rows.length} rows covering ${dates[0]} to ${dates[dates.length - 1]}`);
}

if (process.argv[1]?.includes("asc-downloads")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
