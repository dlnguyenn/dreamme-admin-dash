"use client";

/**
 * Brands side by side: the same rows for each brand (how much it runs, how
 * much is new, what holds the top, who it runs as, where the clicks go) and
 * its three best-ranked creatives. Desktop is a table with one column per
 * brand; on a phone each brand is its own block with the same rows.
 */

import * as React from "react";
import { TrendChart } from "../plan/TrendChart";
import type { AdView } from "@/lib/competitor-ads-tab/logic";
import { NEW_DAYS, collapseCopies, inSet, sortAds } from "@/lib/competitor-ads-tab/filters";
import type { BrandView, CompetitorAdsPayload } from "@/lib/competitor-ads-tab/read";
import { About, H2, MixBar, adHeadline, num, pctText, shortDay, thumbSrc } from "./parts";

interface Row {
  label: string;
  value: (b: BrandView, ads: AdView[]) => React.ReactNode;
}

const addDays = (day: string, n: number) => (day ? new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : "");

function big(v: React.ReactNode, sub?: React.ReactNode) {
  return (
    <>
      <div style={{ font: "650 20px var(--font-ui)", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{v}</div>
      {sub && <div style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-2)", marginTop: 2 }}>{sub}</div>}
    </>
  );
}

export function CompareView({
  data,
  brand,
  isMobile,
  onOpen,
  onSeeAds,
}: {
  data: CompetitorAdsPayload;
  brand: string;
  isMobile: boolean;
  onOpen: (a: AdView) => void;
  onSeeAds: (brand: string) => void;
}) {
  const brands = brand === "all" ? data.brands : data.brands.filter((b) => b.name === brand);
  const adsOf = (b: BrandView) => data.ads.filter((a) => a.brand === b.name);

  const rows: Row[] = [
    {
      label: "Live ads",
      value: (b, ads) => {
        const last = b.daily.at(-1);
        const weekAgo = b.daily.find((d) => d.day === addDays(last?.day ?? "", -7));
        return big(num(b.live), `${num(collapseCopies(ads).length)} distinct creatives. ${weekAgo ? `${num(weekAgo.active)} ads a week ago` : "No count a week ago yet"}`);
      },
    },
    {
      label: `New in the last ${NEW_DAYS} days`,
      value: (_b, ads) => {
        const fresh = ads.filter((a) => inSet(a, "new"));
        return big(`${num(fresh.length)} ads`, `${num(collapseCopies(fresh).length)} creatives`);
      },
    },
    {
      label: "Ads in the top 20 on 7+ of the last 14 days",
      value: (b, ads) => (b.rankDays >= 7 ? big(num(ads.filter((a) => a.rank.top20 >= 7).length)) : big("—", b.rankDays ? `Only ${b.rankDays} ${b.rankDays === 1 ? "day" : "days"} of ranks so far` : "No ranks yet")),
    },
    {
      label: "Breakouts now",
      value: (b, ads) => (b.rankDays >= 8 ? big(`${num(collapseCopies(ads.filter((a) => inSet(a, "rising"))).length)} creatives`, `${num(ads.filter((a) => inSet(a, "rising")).length)} ads`) : big("—", b.rankDays ? "Needs a week of ranks" : "No ranks yet")),
    },
    {
      label: "Run as creator accounts",
      value: (b, ads) => big(b.live ? pctText(ads.filter((a) => a.isPartnership).length / b.live) : "—"),
    },
    {
      label: "Where the clicks go",
      value: (b) => {
        const m = data.landing.find((x) => x.brand === b.name);
        const pages = data.cpps.filter((p) => p.brand === b.name).length;
        const linked = m ? m.live - m.none : 0;
        if (!m || !linked) return big("—", "No links captured");
        return big(
          pages ? `${pages} store ${pages === 1 ? "page" : "pages"}` : "Default store page",
          pages ? `${pctText(m.appStoreCpp / linked)} of linked ads use a custom page` : `${pctText((m.appStoreDefault + m.play) / linked)} to the app stores, ${pctText(m.web / linked)} web`,
        );
      },
    },
    { label: "Formats", value: (b) => <MixBar mix={b.mix} /> },
    {
      label: "Best-ranked creatives now",
      value: (_b, ads) => <TopThree ads={sortAds(collapseCopies(ads.filter((a) => a.rank.now != null)), "rank").slice(0, 3)} onOpen={onOpen} />,
    },
  ];

  const head = (b: BrandView) => {
    const scraped = b.pages.map((p) => p.lastScrapedAt).filter(Boolean).sort().at(-1) ?? null;
    return (
      <>
        <div style={{ font: "650 16px var(--font-ui)", color: "var(--ink)" }}>{b.name}</div>
        <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-2)", marginTop: 2 }}>
          {scraped ? `Scraped ${shortDay(scraped)}` : "Not scraped yet"}
          {b.pages.length > 1 ? `, ${b.pages.length} pages` : ""}
        </div>
      </>
    );
  };
  const seeAds = (b: BrandView) => (
    <button onClick={() => onSeeAds(b.name)} className="cad-focus" style={{ all: "unset", cursor: "pointer", font: "500 13px var(--font-ui)", color: "var(--link)", borderRadius: 4 }}>
      See all {b.name} ads
    </button>
  );

  return (
    <>
      {isMobile ? (
        <div style={{ display: "grid", gap: 30, marginTop: 20 }}>
          {brands.map((b) => {
            const ads = adsOf(b);
            return (
              <section key={b.key}>
                {head(b)}
                <dl style={{ margin: "12px 0 0", display: "grid", gap: 14 }}>
                  {rows.map((r) => (
                    <div key={r.label}>
                      <dt style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink-2)", marginBottom: 4 }}>{r.label}</dt>
                      <dd style={{ margin: 0 }}>{r.value(b, ads)}</dd>
                    </div>
                  ))}
                </dl>
                <div style={{ marginTop: 12 }}>{seeAds(b)}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 180 + brands.length * 220 }}>
            <colgroup>
              <col style={{ width: 180 }} />
              {brands.map((b) => (
                <col key={b.key} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left", padding: "0 16px 14px 0" }}>
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Measure</span>
                </th>
                {brands.map((b) => (
                  <th key={b.key} scope="col" style={{ textAlign: "left", padding: "0 20px 14px 0", fontWeight: "inherit", verticalAlign: "bottom" }}>
                    {head(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" style={{ textAlign: "left", verticalAlign: "top", padding: "14px 16px 14px 0", borderTop: "1px solid var(--line)", font: "400 13px/1.4 var(--font-ui)", color: "var(--ink-2)" }}>
                    {r.label}
                  </th>
                  {brands.map((b) => (
                    <td key={b.key} style={{ verticalAlign: "top", padding: "14px 20px 14px 0", borderTop: "1px solid var(--line)" }}>
                      {r.value(b, adsOf(b))}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td />
                {brands.map((b) => (
                  <td key={b.key} style={{ padding: "4px 20px 0 0" }}>
                    {seeAds(b)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <H2>Live ads per day</H2>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.min(2, brands.length)}, minmax(0, 1fr))`, gap: 18 }}>
        {brands.map((b) => {
          const pts = b.daily.slice(-120).map((d) => ({ x: d.day, y: d.active, note: `${d.video} video, ${d.dco} DCO, ${d.image} image${d.other ? `, ${d.other} other` : ""}` }));
          return (
            <div key={b.key} style={{ minWidth: 0 }}>
              <div style={{ font: "600 13px var(--font-ui)", color: "var(--ink)", marginBottom: 6 }}>{b.name}</div>
              {pts.length >= 2 ? (
                <TrendChart points={pts} color="var(--cat-1)" format={(v) => num(v)} ariaLabel={`${b.name} live ads per day`} height={150} />
              ) : (
                <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)", padding: "24px 0" }}>No daily counts yet. They start with the first daily scrape.</div>
              )}
            </div>
          );
        })}
      </div>

      <About>
        <p style={{ margin: 0 }}>
          Ads and creatives: a brand often runs one video as several ads. The Ads view shows one card per creative, so its counts match the creative figures here, not the ad counts.
        </p>
        <p style={{ margin: 0 }}>
          Creator accounts: the ad runs under someone else&apos;s name &ldquo;with&rdquo; the brand. Outlier&apos;s own partnership flag misses most of them, so any ad whose account differs from the brand&apos;s page counts.
        </p>
        <p style={{ margin: 0 }}>Store pages are counted from live ads whose link carries a Custom Product Page id; Outlier misses the link on many ads, so page counts are floors.</p>
        <p style={{ margin: 0 }}>Daily counts before Nov 5 were seeded from Foreplay; Outlier counts every identity, so its numbers run above Foreplay&apos;s. Dosely and Pep AI aren&apos;t tracked yet: each would be one more brand in Outlier and a few ScrapeCreators credits a day.</p>
      </About>
    </>
  );
}

function TopThree({ ads, onOpen }: { ads: AdView[]; onOpen: (a: AdView) => void }) {
  if (!ads.length) return <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-2)" }}>No ranks yet</span>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, maxWidth: 320 }}>
      {ads.map((a) => (
        <button key={a.id} onClick={() => onOpen(a)} aria-label={`Open #${a.rank.now}: ${adHeadline(a)}`} className="cad-focus" style={{ all: "unset", cursor: "pointer", display: "block", minWidth: 0, borderRadius: 8 }}>
          <span style={{ display: "block", aspectRatio: "4 / 5", borderRadius: 8, overflow: "hidden", background: "var(--bg-2)", position: "relative" }}>
            {a.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbSrc(a.thumb, 240)} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ position: "absolute", inset: 0, padding: 8, font: "500 11px/1.3 var(--font-ui)", color: "var(--ink)", overflow: "hidden" }}>{adHeadline(a)}</span>
            )}
          </span>
          <span style={{ display: "block", font: "600 13px var(--font-ui)", color: "var(--ink)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>#{a.rank.now}</span>
        </button>
      ))}
    </div>
  );
}
