"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button, useToast } from "./ui";
import { Icons } from "./Icons";
import { SpendAddModal } from "./SpendAddModal";
import { SpendImportCsvModal } from "./SpendImportCsvModal";
import {
  CategoryTag,
  DeltaChip,
  ErrorBanner,
  SectionHeader,
  StatStrip,
  type Family,
} from "./porcelain";
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

// "↑ 12%" / "↓ 8%" delta vs a prior value; null when no baseline.
function pctDelta(cur: number, prev: number): string | null {
  if (!prev) return null;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(d)) return null;
  const arrow = d >= 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(d).toFixed(0)}%`;
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
  const prevAll = items
    .filter((it) => monthKey(it.periodStart) === prevMonth)
    .reduce((s, it) => s + it.amountUsd, 0);

  const mtdAI = AI_VENDORS.reduce((s, v) => s + vendorTotal(v, mtd), 0);
  const prevAI = AI_VENDORS.reduce((s, v) => s + vendorTotal(v, prevMonth), 0);
  const mtdBiz = BUSINESS_VENDORS.reduce((s, v) => s + vendorTotal(v, mtd), 0);
  const prevBiz = BUSINESS_VENDORS.reduce(
    (s, v) => s + vendorTotal(v, prevMonth),
    0,
  );

  const runSync = async () => {
    setSyncing(true);
    try {
      const endpoints: Array<{ name: string; url: string }> = [
        { name: "anthropic", url: "/api/cron/spend/anthropic" },
        { name: "apify", url: "/api/cron/spend/apify" },
        { name: "gemini", url: "/api/cron/spend/gemini" },
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
      <div
        style={{
          padding: 80,
          textAlign: "center",
          color: "var(--ink-3)",
          font: "400 14px var(--font-ui)",
        }}
      >
        Loading spend…
      </div>
    );
  }

  const stripStat = (label: string, value: number, prev: number) => ({
    label,
    value: fmtUSD(value),
    delta: pctDelta(value, prev) ?? undefined,
    deltaFamily: (pctDelta(value, prev) ? "neutral" : undefined) as
      | Family
      | undefined,
    note: `vs ${monthLabel(prevMonth)} ${fmtUSD(prev)}`,
  });

  return (
    <>
      <PageHeader
        eyebrow="Admin / Finance"
        title="Spend"
        subtitle="Birds-eye view of AI + business expenses. API-backed where possible, manual entry otherwise."
        actions={
          <>
            <Button
              variant="secondary"
              icon={syncing ? undefined : <Icons.Refresh />}
              onClick={runSync}
              disabled={syncing}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
            <Button
              variant="secondary"
              icon={<Icons.Upload />}
              onClick={() => setShowImport(true)}
            >
              Import CSV
            </Button>
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

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <StatStrip
        minColWidth={200}
        stats={[
          stripStat("Total MTD", mtdAll, prevAll),
          stripStat("AI MTD", mtdAI, prevAI),
          stripStat("Business MTD", mtdBiz, prevBiz),
        ]}
      />

      <SectionHeader
        family="success"
        icon="Dollar"
        title="AI spend"
        meta={`${fmtUSD(mtdAI)} MTD`}
      />
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

      <SectionHeader
        family="neutral"
        icon="CardOutline"
        title="Business spend"
        meta={`${fmtUSD(mtdBiz)} MTD`}
      />
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
  const delta = pctDelta(mtd, prev);

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 16,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            font: "650 10.5px var(--font-ui)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          {VENDOR_LABELS[vendor]}
        </div>
        <CategoryTag
          family={VENDOR_CATEGORY[vendor] === "ai" ? "accent" : "neutral"}
        >
          {VENDOR_CATEGORY[vendor].toUpperCase()}
        </CategoryTag>
      </div>
      <div
        style={{
          font: "700 26px/1 var(--font-ui)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        {fmtUSD(mtd)}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          minHeight: 20,
        }}
      >
        {delta && (
          <DeltaChip family="neutral" size={11.5}>
            {delta}
          </DeltaChip>
        )}
        <span
          style={{
            font: "400 11.5px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink-4)",
          }}
        >
          Last month {fmtUSD(prev)}
        </span>
      </div>
      <MonthlyBars series={series} max={max} />
    </div>
  );
}

function MonthlyBars({
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
      {/* baseline gridline */}
      <line x1={0} y1={H} x2={W} y2={H} stroke="var(--chart-grid)" strokeWidth={1} />
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
              fill="var(--chart-bar)"
              opacity={pt.value > 0 ? 0.9 : 0.18}
            />
            <text
              x={x + barW / 2}
              y={H + 11}
              textAnchor="middle"
              fontSize={8}
              fontWeight={500}
              fill="var(--ink-3)"
              fontFamily="var(--font-ui)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {pt.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
