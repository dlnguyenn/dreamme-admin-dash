"use client";

/**
 * Overview > Experiments. Answers three questions in one look: what is
 * running, what is it doing, and what is waiting on me.
 *
 * The Experiments tab holds every test and every shipped change together,
 * newest first, which is the right record and the wrong summary. Here the
 * shipped changes collapse into a count, tests that need a decision come
 * first, and every running test carries the one line that says whether it is
 * doing anything.
 *
 * Freshness is shown, not assumed: if the daily check stops, this panel says
 * so instead of quietly serving an old snapshot.
 */

import * as React from "react";
import type { ExperimentItem, ExperimentsSection } from "@/lib/overview-experiments";
import type { DashId } from "../Shell";
import { Icons } from "../Icons";
import { Card, InfoWell, SectionHeader, fam } from "../porcelain";
import { EmptyState, GoToLink, relTime } from "./shared";

/** One test or change. The title carries the weight; the state is a word, not a badge. */
function Row({ item, last }: { item: ExperimentItem; last: boolean }) {
  const warn = item.attention;
  const family = warn ? (warn.level === "critical" ? "danger" : "warning") : "neutral";
  return (
    <div style={{ display: "flex", gap: 10, padding: last ? "10px 0 0" : "10px 0 14px" }}>
      {warn ? (
        <span style={{ flex: "0 0 auto", marginTop: 2, color: fam(family).text, display: "flex" }}>
          {warn.level === "critical" ? (
            <Icons.Octagon size={14} stroke="currentColor" />
          ) : (
            <Icons.TriAlert size={14} stroke="currentColor" />
          )}
        </span>
      ) : (
        <span style={{ flex: "0 0 auto", marginTop: 5, color: "var(--ink-4)", display: "flex" }}>
          <Icons.Flask size={13} stroke="currentColor" />
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "600 13px/1.4 var(--font-ui)", color: "var(--ink-1)" }}>
          {item.title}
          <span style={{ font: "400 12px/1.4 var(--font-ui)", color: "var(--ink-3)" }}> · {item.stage}</span>
        </div>
        {(warn || item.reading) && (
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: warn ? fam(family).text : "var(--ink-2)", marginTop: 2 }}>
            {warn ? `${warn.why} ${warn.action}` : item.reading}
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ label, items }: { label: string; items: ExperimentItem[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ font: "500 12px/1.4 var(--font-ui)", color: "var(--ink-3)" }}>{label}</div>
      {items.map((item, i) => (
        <Row key={item.id} item={item} last={i === items.length - 1} />
      ))}
    </div>
  );
}

export function ExperimentsPanel({
  section,
  onNavigate,
}: {
  section: ExperimentsSection | null;
  onNavigate: (id: DashId) => void;
}) {
  if (!section) {
    return (
      <section>
        <SectionHeader family="info" icon="Flask" title="Experiments" />
        <EmptyState title="No check has run yet">
          Once the daily check runs, what is running and what needs a decision shows here.
        </EmptyState>
      </section>
    );
  }

  const tests = section.items.filter((i) => i.kind === "experiment");
  const needsYou = section.items.filter((i) => i.attention);
  const running = tests.filter((i) => !i.attention && (i.state === "reading" || i.state === "too_early"));
  const notStarted = tests.filter((i) => !i.attention && i.state === "not_started");
  const { counts, staleness } = section;
  const stopped = staleness.level === "stopped";

  return (
    <section>
      <SectionHeader
        family={needsYou.length ? "warning" : "info"}
        icon="Flask"
        title="Experiments"
        meta={stopped ? "check has stopped" : `checked ${relTime(section.checkedAt)}`}
        right={<GoToLink label="Full log" onClick={() => onNavigate("experiments")} />}
      />
      <Card>
        <div style={{ font: "600 14px/1.45 var(--font-ui)", color: "var(--ink-1)" }}>
          {section.headline || "Nothing on the log yet"}
        </div>

        <Group label="Waiting on you" items={needsYou} />
        <Group label="Running" items={running} />
        <Group label="Agreed, not started" items={notStarted} />

        {(counts.changes > 0 || counts.settled > 0) && (
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)", marginTop: 16 }}>
            {counts.changes > 0 && `${counts.changes} shipped change${counts.changes === 1 ? "" : "s"}`}
            {counts.changes > 0 && counts.settled > 0 && " and "}
            {counts.settled > 0 && `${counts.settled} settled test${counts.settled === 1 ? "" : "s"}`}
            {" are on the log for the record. Nothing to decide on those."}
          </div>
        )}

        {stopped && (
          <InfoWell style={{ marginTop: 14, color: fam("danger").text, background: fam("danger").soft }}>
            The check that keeps this up to date last ran {relTime(section.checkedAt)} and is meant to run every day,
            so these numbers may be behind. It runs at 12:40 UTC from the dashboard’s own schedule.
          </InfoWell>
        )}
        {!stopped && staleness.level === "late" && (
          <InfoWell style={{ marginTop: 14 }}>
            Last checked {relTime(section.checkedAt)}, a little later than the daily run. Nothing is wrong yet.
          </InfoWell>
        )}
        {section.rcError && !stopped && (
          <InfoWell style={{ marginTop: 14 }}>
            RevenueCat could not be read on the last check ({section.rcError}), so any numbers above come from the
            check before it.
          </InfoWell>
        )}
      </Card>
    </section>
  );
}
