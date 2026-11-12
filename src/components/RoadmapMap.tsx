"use client";

/**
 * Roadmap Map view: the same items as the board, laid out on a timeline.
 * Weeks run left to right with a Today line; each dated item is a bar from
 * when it was added to its target (a diamond), late stretches in red, done
 * items as a check where they finished. Drag a diamond to reschedule, drag
 * an Unscheduled chip onto the map to give it a date, click for details.
 * Date math lives in src/lib/roadmap-map.ts.
 */
import * as React from "react";
import { StatStrip, Segmented } from "./porcelain";
import { Chip } from "./ui";
import {
  STAGE_HINTS,
  isOverdue,
  ownerEdge,
  ownerWash,
  todayIso,
  type RoadmapItem,
  type RoadmapStage,
} from "@/lib/roadmap";
import {
  dayLabel,
  dayToIso,
  isoToDay,
  mapLanes,
  mapRange,
  trajectory,
  weekday,
  type ItemSpan,
  type MapGroupBy,
} from "@/lib/roadmap-map";

const ROW_H = 38;
const LANE_H = 30;
const HEAD_H = 46;
const MIN_PPD = 7;

const STAGE_COLOR: Record<RoadmapStage, string> = {
  now: "var(--accent)",
  next: "var(--info)",
  later: "var(--ink-4)",
  done: "var(--success)",
};

const GROUP_KEY = "dad.roadmap.mapGroup";

export function RoadmapMap({
  items,
  onOpen,
  onReschedule,
}: {
  items: RoadmapItem[];
  onOpen: (item: RoadmapItem) => void;
  onReschedule: (id: string, targetDate: string) => void;
}) {
  const today = isoToDay(todayIso());
  const [groupBy, setGroupBy] = React.useState<MapGroupBy>("stage");
  React.useEffect(() => {
    try {
      const g = window.localStorage.getItem(GROUP_KEY);
      if (g === "stage" || g === "owner") setGroupBy(g);
    } catch {}
  }, []);
  const pickGroup = (g: MapGroupBy) => {
    setGroupBy(g);
    try {
      window.localStorage.setItem(GROUP_KEY, g);
    } catch {}
  };

  // Fit the range to the panel width, never squeezing a day under MIN_PPD.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(1000);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const labelW = width < 640 ? 132 : 250;

  const range = React.useMemo(() => mapRange(items, today), [items, today]);
  const { lanes, unscheduled } = React.useMemo(
    () => mapLanes(items, groupBy, today, range),
    [items, groupBy, today, range],
  );
  const traj = React.useMemo(() => trajectory(items, today), [items, today]);

  const ppd = Math.max(MIN_PPD, (width - labelW) / range.days);
  const trackW = Math.round(ppd * range.days);
  const x = (day: number) => (day - range.start) * ppd;

  // On a narrow screen, open scrolled so today sits a week in from the
  // left: the point of the map is what's ahead.
  const scrolledOnce = React.useRef(false);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || scrolledOnce.current || el.scrollWidth <= el.clientWidth) return;
    scrolledOnce.current = true;
    el.scrollLeft = Math.max(0, x(today) - 7 * ppd);
  }, [width, trackW]);

  // Dropping an Unscheduled chip on the map sets its target to that day.
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [dropDay, setDropDay] = React.useState<number | null>(null);
  const dayAtClientX = (clientX: number): number | null => {
    const el = innerRef.current;
    if (!el) return null;
    const px = clientX - el.getBoundingClientRect().left - labelW;
    if (px < 0 || px > trackW) return null;
    return range.start + Math.floor(px / ppd);
  };

  const rowsH = lanes.reduce((h, l) => h + LANE_H + l.rows.length * ROW_H, 0);
  const emptyH = lanes.length === 0 ? 120 : 0;
  const bodyH = HEAD_H + rowsH + emptyH;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <StatStrip
        minColWidth={140}
        stats={[
          {
            label: "Overdue",
            value: (
              <span
                style={{ color: traj.overdue ? "var(--danger)" : undefined }}
              >
                {traj.overdue}
              </span>
            ),
          },
          { label: "Due this week", value: traj.thisWeek },
          { label: "Next 30 days", value: traj.next30 },
          {
            label: "Next up",
            value: (
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  lineHeight: 1.35,
                  display: "block",
                }}
              >
                {traj.nextUp ? traj.nextUp.title : "Nothing dated"}
              </span>
            ),
            note: traj.nextUp?.target_date
              ? dueIn(isoToDay(traj.nextUp.target_date) - today)
              : undefined,
          },
        ]}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Legend />
        <Segmented
          size="sm"
          value={groupBy}
          onChange={(v) => pickGroup(v as MapGroupBy)}
          options={[
            { value: "stage", label: "By stage" },
            { value: "owner", label: "By owner" },
          ]}
        />
      </div>

      <div
        ref={scrollRef}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          boxShadow: "var(--shadow-card)",
          overflowX: "auto",
          overflowY: "hidden",
          // The wide timeline scrolls in here instead of widening the page.
          contain: "inline-size",
          minWidth: 0,
        }}
      >
        <div
          ref={innerRef}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("application/x-roadmap-id"))
              return;
            const d = dayAtClientX(e.clientX);
            if (d === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropDay(d);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDropDay(null);
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("application/x-roadmap-id");
            const d = dayAtClientX(e.clientX);
            setDropDay(null);
            if (!id || d === null) return;
            e.preventDefault();
            onReschedule(id, dayToIso(d));
          }}
          style={{
            position: "relative",
            width: labelW + trackW,
            minHeight: bodyH,
          }}
        >
          <Grid
            range={range}
            today={today}
            ppd={ppd}
            left={labelW}
            height={bodyH}
            dropDay={dropDay}
          />
          <Header range={range} today={today} ppd={ppd} labelW={labelW} />

          {lanes.map((lane) => (
            <React.Fragment key={lane.key}>
              <div
                style={{
                  display: "flex",
                  height: LANE_H,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    ...stickyLabel(labelW),
                    background: "var(--surface-2)",
                    borderTop: "1px solid var(--line)",
                    borderBottom: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 14px",
                  }}
                >
                  {lane.stage && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: STAGE_COLOR[lane.stage],
                        flex: "none",
                      }}
                    />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 650 }}>
                    {lane.label}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {lane.rows.length}
                  </span>
                  {lane.stage && labelW > 200 && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--ink-4)",
                        marginLeft: "auto",
                      }}
                    >
                      {STAGE_HINTS[lane.stage]}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    flex: "none",
                    width: trackW,
                    borderTop: "1px solid var(--line)",
                    borderBottom: "1px solid var(--line)",
                    background:
                      "color-mix(in oklab, var(--surface-2) 70%, transparent)",
                  }}
                />
              </div>
              {lane.rows.map(({ item, span }) => (
                <Row
                  key={item.id}
                  item={item}
                  span={span}
                  labelW={labelW}
                  trackW={trackW}
                  ppd={ppd}
                  x={x}
                  showStageDot={groupBy === "owner"}
                  onOpen={() => onOpen(item)}
                  onReschedule={(day) => onReschedule(item.id, dayToIso(day))}
                />
              ))}
            </React.Fragment>
          ))}

          {lanes.length === 0 && (
            <div
              style={{
                position: "relative",
                height: emptyH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 24px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--ink-3)",
              }}
            >
              Nothing on the map yet. Drag an item from Unscheduled onto a day,
              or set a target date in its details.
            </div>
          )}
        </div>
      </div>

      <Unscheduled items={unscheduled} onOpen={onOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Background grid: past wash, weekends, week lines, today line, drop marker

function Grid({
  range,
  today,
  ppd,
  left,
  height,
  dropDay,
}: {
  range: { start: number; end: number; days: number };
  today: number;
  ppd: number;
  left: number;
  height: number;
  dropDay: number | null;
}) {
  const cols: React.ReactNode[] = [];
  for (let d = range.start; d < range.end; d++) {
    const wd = weekday(d);
    const px = (d - range.start) * ppd;
    if (wd >= 5) {
      cols.push(
        <div
          key={`w${d}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: px,
            width: ppd,
            background: "color-mix(in oklab, var(--bg-2) 45%, transparent)",
          }}
        />,
      );
    }
    if (wd === 0) {
      cols.push(
        <div
          key={`l${d}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: px,
            width: 1,
            background: "var(--line)",
          }}
        />,
      );
    }
  }
  const todayX = (today - range.start) * ppd;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: 0,
        height,
        right: 0,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: todayX,
          background: "color-mix(in oklab, var(--bg-2) 35%, transparent)",
        }}
      />
      {cols}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: todayX + ppd / 2 - 1,
          width: 2,
          background: "var(--accent)",
          opacity: 0.85,
          zIndex: 3,
        }}
      />
      {dropDay !== null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: (dropDay - range.start) * ppd,
            width: Math.max(ppd, 2),
            background: "color-mix(in oklab, var(--accent) 22%, transparent)",
            outline: "1px dashed var(--accent)",
            zIndex: 4,
          }}
        >
          <span
            style={{
              ...tag,
              top: 4,
              left: ppd + 4,
              background: "var(--ink)",
              color: "var(--bg)",
            }}
          >
            {dayLabel(dropDay)}
          </span>
        </div>
      )}
    </div>
  );
}

function Header({
  range,
  today,
  ppd,
  labelW,
}: {
  range: { start: number; end: number; days: number };
  today: number;
  ppd: number;
  labelW: number;
}) {
  const months: { day: number; label: string }[] = [];
  const weeks: number[] = [];
  for (let d = range.start; d < range.end; d++) {
    const date = new Date(d * 86_400_000);
    if (d === range.start || date.getUTCDate() === 1) {
      months.push({
        day: d,
        label: date.toLocaleDateString("en-US", {
          month: "long",
          timeZone: "UTC",
        }),
      });
    }
    if (weekday(d) === 0) weeks.push(d);
  }
  const showWeekNums = ppd * 7 >= 38;
  const todayX = (today - range.start) * ppd + ppd / 2;
  return (
    <div style={{ display: "flex", height: HEAD_H, position: "relative" }}>
      <div
        style={{
          ...stickyLabel(labelW),
          display: "flex",
          alignItems: "flex-end",
          padding: "0 14px 8px",
          background: "var(--surface)",
        }}
      >
        <span style={eyebrow}>Item</span>
      </div>
      <div style={{ position: "relative", flex: 1 }}>
        {months.map((m, i) => {
          const next = months[i + 1]?.day ?? range.end;
          // A sliver of a month at the left edge gets no label.
          if ((next - m.day) * ppd < 48) return null;
          return (
            <span
              key={m.day}
              style={{
                position: "absolute",
                top: 7,
                left: (m.day - range.start) * ppd + 6,
                fontSize: 12,
                fontWeight: 650,
                color: "var(--ink-2)",
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </span>
          );
        })}
        {weeks.map((w) => {
          // The Today tag sits on this row; drop a week label it would cover.
          const wx = (w - range.start) * ppd + 5;
          if (wx > todayX - 44 && wx < todayX + 48) return null;
          return (
            <span
              key={w}
              style={{
                position: "absolute",
                bottom: 7,
                left: (w - range.start) * ppd + 5,
                fontSize: 10.5,
                color: "var(--ink-3)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {showWeekNums ? dayLabel(w) : ""}
            </span>
          );
        })}
        <span
          style={{
            ...tag,
            bottom: 5,
            left: todayX + 4,
            background: "var(--accent)",
            color: "var(--on-accent)",
            zIndex: 5,
          }}
        >
          Today
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One item row

function Row({
  item,
  span,
  labelW,
  trackW,
  ppd,
  x,
  showStageDot,
  onOpen,
  onReschedule,
}: {
  item: RoadmapItem;
  span: ItemSpan;
  labelW: number;
  trackW: number;
  ppd: number;
  x: (day: number) => number;
  showStageDot: boolean;
  onOpen: () => void;
  onReschedule: (day: number) => void;
}) {
  const color = STAGE_COLOR[item.stage];
  const overdue = isOverdue(item);
  const mid = ROW_H / 2;

  // Drag the diamond sideways to move the target date (snaps to days).
  const [dragDelta, setDragDelta] = React.useState<number | null>(null);
  const drag = React.useRef<{ startX: number; moved: boolean } | null>(null);
  const target = span.kind === "scheduled" ? span.target + (dragDelta ?? 0) : 0;

  return (
    <div style={{ display: "flex", height: ROW_H, position: "relative" }}>
      <button
        onClick={onOpen}
        title={item.title}
        style={{
          ...stickyLabel(labelW),
          minHeight: 0,
          border: "none",
          borderBottom:
            "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
          background: "var(--surface)",
          textAlign: "left",
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          color: item.stage === "done" ? "var(--ink-3)" : "var(--ink)",
          font: "500 12.5px var(--font-ui)",
        }}
      >
        {showStageDot && (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 2,
              background: color,
              flex: "none",
            }}
            title={item.stage}
          />
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: item.stage === "done" ? "line-through" : "none",
          }}
        >
          {item.title}
        </span>
        {item.priority === "high" && item.stage !== "done" && labelW > 200 && (
          <span style={{ marginLeft: "auto", flex: "none" }}>
            <Chip tone="accent">High</Chip>
          </span>
        )}
      </button>

      <div
        style={{
          position: "relative",
          flex: "none",
          width: trackW,
          borderBottom:
            "1px solid color-mix(in oklab, var(--line) 60%, transparent)",
        }}
      >
        {span.kind === "scheduled" && (
          <>
            <div
              onClick={onOpen}
              title={`${item.title} · added ${dayLabel(span.from)}`}
              style={{
                position: "absolute",
                top: mid - 4,
                height: 8,
                left: x(span.from),
                width: Math.max(2, x(target) - x(span.from) + ppd / 2),
                borderRadius: 4,
                background: `color-mix(in oklab, ${color} 28%, transparent)`,
                cursor: "pointer",
                zIndex: 2,
              }}
            />
            {span.overdueTo !== null && dragDelta === null && (
              <div
                title={`${span.overdueTo - span.target} days late`}
                style={{
                  position: "absolute",
                  top: mid - 4,
                  height: 8,
                  left: x(span.target) + ppd / 2,
                  width: Math.max(2, x(span.overdueTo) - x(span.target)),
                  borderRadius: 4,
                  background:
                    "repeating-linear-gradient(135deg, var(--danger) 0 4px, color-mix(in oklab, var(--danger) 35%, transparent) 4px 8px)",
                  zIndex: 2,
                }}
              />
            )}
            <div
              role="button"
              aria-label={`${item.title}, due ${dayLabel(target)}. Drag to reschedule.`}
              title="Drag to change the target date"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { startX: e.clientX, moved: false };
                setDragDelta(0);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                const dx = e.clientX - drag.current.startX;
                if (Math.abs(dx) > 3) drag.current.moved = true;
                setDragDelta(Math.round(dx / ppd));
              }}
              onPointerUp={() => {
                const d = drag.current;
                const delta = dragDelta ?? 0;
                drag.current = null;
                setDragDelta(null);
                if (!d) return;
                if (!d.moved) onOpen();
                else if (delta !== 0) onReschedule(span.target + delta);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setDragDelta(null);
              }}
              style={{
                position: "absolute",
                top: mid - 7,
                left: x(target) + ppd / 2 - 7,
                width: 14,
                height: 14,
                minHeight: 0, // beat the phone tap-target rule in globals.css
                transform: "rotate(45deg)",
                borderRadius: 3,
                background:
                  overdue && dragDelta === null ? "var(--danger)" : color,
                boxShadow:
                  dragDelta !== null
                    ? "0 0 0 4px color-mix(in oklab, var(--accent) 25%, transparent)"
                    : "0 0 0 2px var(--surface)",
                cursor: dragDelta !== null ? "grabbing" : "grab",
                touchAction: "none",
                zIndex: 6,
              }}
            />
            <span
              style={{
                position: "absolute",
                top: mid - 8,
                // A late item's label sits past the red stretch, not on it.
                left:
                  span.overdueTo !== null && dragDelta === null
                    ? x(span.overdueTo) + ppd / 2 + 10
                    : x(target) + ppd / 2 + 12,
                fontSize: 11,
                lineHeight: "16px",
                whiteSpace: "nowrap",
                fontWeight: dragDelta !== null ? 650 : 500,
                color:
                  dragDelta !== null
                    ? "var(--ink)"
                    : overdue
                      ? "var(--danger-text)"
                      : "var(--ink-3)",
                pointerEvents: "none",
                zIndex: 6,
              }}
            >
              {dayLabel(target)}
              {overdue && dragDelta === null && span.overdueTo !== null
                ? ` · ${span.overdueTo - span.target}d late`
                : ""}
              {item.owner ? ` · ${item.owner}` : ""}
            </span>
          </>
        )}

        {span.kind === "done" && (
          <>
            <div
              style={{
                position: "absolute",
                top: mid - 3,
                height: 6,
                left: x(span.from),
                width: Math.max(2, x(span.at) - x(span.from) + ppd / 2),
                borderRadius: 3,
                background:
                  "color-mix(in oklab, var(--success) 18%, transparent)",
                zIndex: 2,
              }}
            />
            <button
              onClick={onOpen}
              aria-label={`${item.title}, done ${dayLabel(span.at)}`}
              style={{
                position: "absolute",
                top: mid - 8,
                left: x(span.at) + ppd / 2 - 8,
                width: 16,
                height: 16,
                minHeight: 0,
                borderRadius: 999,
                border: "2px solid var(--surface)",
                background: "var(--success)",
                color: "var(--on-solid)",
                fontSize: 9,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
                zIndex: 6,
              }}
            >
              ✓
            </button>
            <span
              style={{
                position: "absolute",
                top: mid - 8,
                left: x(span.at) + ppd / 2 + 12,
                fontSize: 11,
                lineHeight: "16px",
                color: "var(--ink-3)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 6,
              }}
            >
              Done {dayLabel(span.at)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unscheduled tray + legend

function Unscheduled({
  items,
  onOpen,
}: {
  items: RoadmapItem[];
  onOpen: (item: RoadmapItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      style={{
        background: "var(--surface-2)",
        border: "1px dashed var(--line-2)",
        borderRadius: 14,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 650 }}>Unscheduled</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {items.length}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          No target date yet. Drag one onto a day on the map, or click to set
          it.
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((item) => (
          <button
            key={item.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-roadmap-id", item.id);
            }}
            onClick={() => onOpen(item)}
            title="Drag onto the map to set a target date"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              maxWidth: "100%",
              padding: "7px 11px",
              borderRadius: 10,
              border: `1px solid ${ownerEdge(item.owner)}`,
              background: ownerWash(item.owner),
              color: "var(--ink)",
              font: "500 12.5px var(--font-ui)",
              cursor: "grab",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                background: STAGE_COLOR[item.stage],
                flex: "none",
              }}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </span>
            {item.priority === "high" && <Chip tone="accent">High</Chip>}
          </button>
        ))}
      </div>
    </section>
  );
}

function Legend() {
  const sw = (bg: string, rotate = false): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: rotate ? 2 : 999,
    background: bg,
    transform: rotate ? "rotate(45deg)" : undefined,
    display: "inline-block",
    flex: "none",
  });
  const item = (swatch: React.ReactNode, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {swatch}
      {label}
    </span>
  );
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        fontSize: 11.5,
        color: "var(--ink-3)",
      }}
    >
      {item(<span style={sw(STAGE_COLOR.now, true)} />, "Now")}
      {item(<span style={sw(STAGE_COLOR.next, true)} />, "Next")}
      {item(<span style={sw(STAGE_COLOR.later, true)} />, "Later")}
      {item(<span style={sw("var(--success)")} />, "Done")}
      {item(
        <span
          style={{
            width: 16,
            height: 6,
            borderRadius: 3,
            background:
              "repeating-linear-gradient(135deg, var(--danger) 0 4px, color-mix(in oklab, var(--danger) 35%, transparent) 4px 8px)",
            display: "inline-block",
          }}
        />,
        "Late",
      )}
      <span>Bar = added → target</span>
    </div>
  );
}

function dueIn(days: number): string {
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

const stickyLabel = (w: number): React.CSSProperties => ({
  position: "sticky",
  left: 0,
  zIndex: 7,
  width: w,
  minWidth: w,
  flex: "none",
});

const eyebrow: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--font-geist-mono), monospace",
  color: "var(--ink-3)",
};

const tag: React.CSSProperties = {
  position: "absolute",
  fontSize: 10,
  fontWeight: 650,
  padding: "2px 6px",
  borderRadius: 6,
  whiteSpace: "nowrap",
  pointerEvents: "none",
};
