"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, Chip, useToast } from "./ui";
import { Icons } from "./Icons";
import { SpendAddModal } from "./SpendAddModal";
import { SpendImportCsvModal } from "./SpendImportCsvModal";
import { PlaidConnect } from "./PlaidConnect";
import { API } from "@/lib/supabase";
import type {
  SpendCategory,
  SpendLineItem,
  SpendVendor,
} from "@/lib/types";

const VENDOR_LABELS: Record<SpendVendor, string> = {
  anthropic: "Anthropic",
  google: "Gemini",
  apify: "Apify",
  vercel: "Vercel",
  supabase: "Supabase",
  business_cc: "Business CC",
  other: "Other",
};

const VENDOR_CATEGORY: Record<SpendVendor, SpendCategory> = {
  anthropic: "ai",
  google: "ai",
  apify: "ai",
  vercel: "ai",
  supabase: "ai",
  business_cc: "business",
  other: "business",
};

const AI_VENDORS: SpendVendor[] = [
  "anthropic",
  "google",
  "apify",
  "vercel",
  "supabase",
];
const BUSINESS_VENDORS: SpendVendor[] = ["business_cc", "other"];

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const maxFrac = abs >= 100 ? 0 : 2;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: maxFrac,
  });
}

function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function lastSixMonths(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short" });
}

function lineItemsByVendorMonth(items: SpendLineItem[]) {
  const map = new Map<SpendVendor, Map<string, number>>();
  for (const it of items) {
    const vm = map.get(it.vendor) ?? new Map<string, number>();
    const key = monthKey(it.periodStart);
    vm.set(key, (vm.get(key) ?? 0) + it.amountUsd);
    map.set(it.vendor, vm);
  }
  return map;
}

export function SpendDashboard() {
  const toast = useToast();
  const [items, setItems] = React.useState<SpendLineItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const rows = await API.fetchSpendLineItems();
      setItems(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const byVendorMonth = React.useMemo(
    () => lineItemsByVendorMonth(items),
    [items],
  );

  const months = React.useMemo(() => lastSixMonths(), []);
  const mtd = currentMonthKey();
  const prevMonth = months[months.length - 2] ?? mtd;

  const vendorTotal = (v: SpendVendor, monthK: string): number => {
    return byVendorMonth.get(v)?.get(monthK) ?? 0;
  };

  const mtdAll = items
    .filter((it) => monthKey(it.periodStart) === mtd)
    .reduce((s, it) => s + it.amountUsd, 0);

  const mtdAI = AI_VENDORS.reduce((s, v) => s + vendorTotal(v, mtd), 0);
  const mtdBiz = BUSINESS_VENDORS.reduce((s, v) => s + vendorTotal(v, mtd), 0);

  const runSync = async () => {
    setSyncing(true);
    try {
      const endpoints: Array<{ name: string; url: string }> = [
        { name: "anthropic", url: "/api/cron/spend/anthropic" },
        { name: "apify", url: "/api/cron/spend/apify" },
        { name: "gemini", url: "/api/cron/spend/gemini" },
        { name: "plaid", url: "/api/cron/spend/plaid" },
      ];
      const results = await Promise.allSettled(
        endpoints.map(async (e) => {
          const res = await fetch(e.url);
          const body = await res.json().catch(() => ({}));
          return { name: e.name, ok: res.ok && body.ok, error: body.error as string | undefined };
        }),
      );
      const oks: string[] = [];
      const fails: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.ok) {
          oks.push(r.value.name);
        } else {
          const name = endpoints[i].name;
          const err =
            r.status === "fulfilled"
              ? r.value.error ?? "unknown error"
              : (r.reason as Error)?.message ?? "network error";
          fails.push(`${name}: ${err}`);
        }
      });
      if (oks.length === endpoints.length) {
        toast(`Synced ${oks.length}/${endpoints.length} vendors`);
      } else if (oks.length === 0) {
        toast(`Sync failed — ${fails.join(" · ")}`);
      } else {
        toast(`Synced ${oks.length}/${endpoints.length} · ${fails.join(" · ")}`);
      }
      await refresh();
    } catch (e) {
      toast(`Sync failed — ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--ink-3)" }}>
        <div className="serif" style={{ fontSize: 24, fontStyle: "italic" }}>
          Loading spend…
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin · Finance"
        title={<em>Spend</em>}
        subtitle="Birds-eye view of AI + business expenses. API-backed where possible, manual entry otherwise."
        tint="color-mix(in oklab, var(--p-olivia) 45%, transparent)"
        actions={
          <>
            <Button
              icon={syncing ? undefined : <Icons.Sparkles />}
              onClick={runSync}
              disabled={syncing}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
            <Button onClick={() => setShowImport(true)}>Import CSV</Button>
            <Button
              variant="primary"
              icon={<Icons.Plus />}
              onClick={() => setShowAdd(true)}
            >
              Add expense
            </Button>
          </>
        }
      />

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background:
              "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 28,
        }}
      >
        <HeadlineCard label="Total MTD" value={fmtUSD(mtdAll)} tone="ink" />
        <HeadlineCard label="AI MTD" value={fmtUSD(mtdAI)} tone="neutral" />
        <HeadlineCard
          label="Business MTD"
          value={fmtUSD(mtdBiz)}
          tone="neutral"
        />
      </div>

      <SectionLabel>AI spend</SectionLabel>
      <CardGrid>
        {AI_VENDORS.map((v) => (
          <VendorCard
            key={v}
            vendor={v}
            mtd={vendorTotal(v, mtd)}
            prev={vendorTotal(v, prevMonth)}
            series={months.map((k) => ({
              label: monthLabel(k),
              value: vendorTotal(v, k),
            }))}
          />
        ))}
      </CardGrid>

      <div style={{ height: 28 }} />

      <SectionLabel>Business spend</SectionLabel>
      <PlaidConnect onChange={refresh} />
      <CardGrid>
        {BUSINESS_VENDORS.map((v) => (
          <VendorCard
            key={v}
            vendor={v}
            mtd={vendorTotal(v, mtd)}
            prev={vendorTotal(v, prevMonth)}
            series={months.map((k) => ({
              label: monthLabel(k),
              value: vendorTotal(v, k),
            }))}
          />
        ))}
      </CardGrid>

      {showAdd && (
        <SpendAddModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            toast("Expense added");
            refresh();
          }}
        />
      )}

      {showImport && (
        <SpendImportCsvModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            toast("CSV imported");
            refresh();
          }}
        />
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: "var(--ink-3)",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

function HeadlineCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "neutral";
}) {
  const isInk = tone === "ink";
  return (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: 14,
        background: isInk ? "var(--ink)" : "var(--surface-2)",
        color: isInk ? "var(--surface)" : "var(--ink)",
        border: isInk ? "1px solid var(--ink)" : "1px solid var(--line)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          opacity: isInk ? 0.7 : 0.6,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        className="serif"
        style={{
          fontSize: 36,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function VendorCard({
  vendor,
  mtd,
  prev,
  series,
}: {
  vendor: SpendVendor;
  mtd: number;
  prev: number;
  series: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const delta = prev > 0 ? ((mtd - prev) / prev) * 100 : null;

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--ink-2)",
          }}
        >
          {VENDOR_LABELS[vendor]}
        </div>
        <Chip tone={VENDOR_CATEGORY[vendor] === "ai" ? "accent" : "neutral"}>
          {VENDOR_CATEGORY[vendor]}
        </Chip>
      </div>
      <div
        className="serif"
        style={{
          fontSize: 28,
          fontWeight: 400,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        {fmtUSD(mtd)}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span>Last month {fmtUSD(prev)}</span>
        {delta !== null && Number.isFinite(delta) && (
          <span
            style={{
              color:
                delta > 0
                  ? "var(--accent)"
                  : "color-mix(in oklab, var(--p-olivia) 60%, var(--ink))",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10,
            }}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(0)}%
          </span>
        )}
      </div>
      <Sparkline series={series} max={max} />
    </div>
  );
}

function Sparkline({
  series,
  max,
}: {
  series: Array<{ label: string; value: number }>;
  max: number;
}) {
  const H = 40;
  const W = 200;
  const BAR_GAP = 4;
  const barW = (W - BAR_GAP * (series.length - 1)) / series.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 14}`}
      width="100%"
      height={H + 14}
      preserveAspectRatio="none"
      style={{ display: "block", marginTop: 2 }}
    >
      {series.map((pt, i) => {
        const h = max > 0 ? (pt.value / max) * H : 0;
        const x = i * (barW + BAR_GAP);
        const y = H - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, 1)}
              rx={2}
              fill="var(--ink-3)"
              opacity={pt.value > 0 ? 0.55 : 0.18}
            />
            <text
              x={x + barW / 2}
              y={H + 11}
              textAnchor="middle"
              fontSize={8}
              fill="var(--ink-4)"
              fontFamily="var(--font-geist-mono), monospace"
            >
              {pt.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
