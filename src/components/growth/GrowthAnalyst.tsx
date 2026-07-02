"use client";

/**
 * Growth AI · Analyst — the Runneth-style "ask it anything" brain plus the
 * one-click Weekly Recap. Chat transcripts persist to localStorage; the
 * recap caches the latest run so revisits don't re-bill.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { MODELS, MODEL_LABELS, type ModelId } from "@/lib/models";
import { type GrowthData, aggregateAds, daysAgoISO } from "./data";
import { ActionCard, actionDetail, type ChatAction, type ActionState } from "./ActionCard";
import {
  fmtUSD,
  fmtInt,
  timeAgo,
  SectionLabel,
  DeltaChip,
  Thumb,
  ErrorBanner,
  MarkdownLite,
} from "./shared";

const CHAT_KEY = "dreamme.growth.chat.v1";
const RECAP_KEY = "dreamme.growth.recap.v1";
const MODEL_KEY = "dreamme.growth.model";

interface AgentStep {
  tool: string;
  ok: boolean;
  summary: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  /** Confirm-gated action proposals attached to this assistant turn. */
  actions?: ChatAction[];
}

interface RecapPerformer {
  ad_id: string;
  why: string;
  who: string;
  what_next: string;
}

interface RecapDoc {
  headline: string;
  summary: string;
  top_performers: RecapPerformer[];
  bottom_performers: RecapPerformer[];
  patterns: Array<{ dimension: string; finding: string }>;
  actions: Array<{ title: string; detail: string; urgency: "now" | "this_week" | "watch" }>;
}

interface RecapStatsAd {
  ad_id: string;
  ad_name: string;
  spend: number;
  trial_starts: number;
  cost_per_trial: number | null;
  hook_rate_pct: number | null;
  ctr_pct: number | null;
}

interface RecapResponse {
  generated_at: string;
  model: string;
  stats: {
    window: { since: string; until: string };
    totals: {
      spend: number;
      spend_delta_pct: number | null;
      cost_per_trial: number | null;
      prev_cost_per_trial: number | null;
      rc_trials: number;
      prev_rc_trials: number;
      rc_revenue: number;
      creatives_launched: number;
      blended_cac_per_trial: number | null;
    };
    ads_this_week: RecapStatsAd[];
  };
  recap: RecapDoc;
  /** Present on DB-persisted rows (history). */
  id?: string;
  week_start?: string;
  source?: "manual" | "cron";
  sent_at?: string | null;
}

const THOUGHT_STARTERS = [
  "Which creatives should we cut, and where should we reallocate the budget?",
  "Why did cost per trial move this week? Break it down by ad.",
  "What patterns do our top performers share? Give me 3 creative briefs to test next.",
  "Is our Meta spend actually paying off? Check blended MER and RC trials, not just Meta numbers.",
  "Which ads have a strong hook but weak hold — and how would you re-cut them?",
];

const RECAP_LOADING_LINES = [
  "Reading every ad in the account…",
  "Comparing this week to last…",
  "Ranking winners and losers…",
  "Looking for creative patterns…",
  "Writing your retro…",
];

function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function GrowthAnalyst({
  data,
  prefill,
  onPrefillConsumed,
}: {
  data: GrowthData;
  prefill: string | null;
  onPrefillConsumed: () => void;
}) {
  const isMobile = useIsMobile();
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<ModelId>(MODELS.SONNET_4_6);
  const [hydrated, setHydrated] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const sendingRef = React.useRef(false);

  React.useEffect(() => {
    const saved = loadJSON<ChatMsg[]>(CHAT_KEY);
    if (saved) setMessages(saved);
    const savedModel = loadJSON<string>(MODEL_KEY);
    if (savedModel === MODELS.SONNET_4_6 || savedModel === MODELS.OPUS_4_7) {
      setModel(savedModel);
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (hydrated) saveJSON(CHAT_KEY, messages.slice(-30));
  }, [messages, hydrated]);

  React.useEffect(() => {
    if (hydrated) saveJSON(MODEL_KEY, model);
  }, [model, hydrated]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = React.useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || sendingRef.current) return;
      sendingRef.current = true;
      setError(null);
      setSending(true);
      setInput("");
      const nextMessages: ChatMsg[] = [...messages, { role: "user", content: q }];
      setMessages(nextMessages);
      try {
        const res = await fetch("/api/growth/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: nextMessages.slice(-16).map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        const body = (await res.json()) as {
          reply?: string;
          steps?: AgentStep[];
          proposals?: Array<Omit<ChatAction, "state">>;
          error?: string;
        };
        if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
        setMessages((cur) => [
          ...cur,
          {
            role: "assistant",
            content: body.reply ?? "(empty reply)",
            steps: body.steps ?? [],
            actions: (body.proposals ?? []).map((p) => ({ ...p, state: "proposed" as const })),
          },
        ]);
      } catch (e) {
        setError((e as Error).message);
        // keep the user turn so they can retry with context intact
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [messages, model],
  );

  // Thought starters from other sub-views land here pre-filled → auto-send.
  React.useEffect(() => {
    if (prefill && hydrated && !sendingRef.current) {
      onPrefillConsumed();
      void send(prefill);
    }
  }, [prefill, hydrated, onPrefillConsumed, send]);

  /**
   * Settle an ActionCard. State persists on the message (so reloads can't
   * re-execute), and applied/failed outcomes append a plain status line so
   * later model turns see what actually happened.
   */
  const resolveAction = React.useCallback(
    (msgIdx: number, actionIdx: number, state: ActionState, resultNote?: string) => {
      setMessages((cur) => {
        const next = cur.map((m, i) => {
          if (i !== msgIdx || !m.actions) return m;
          const actions = m.actions.map((a, ai) =>
            ai === actionIdx ? { ...a, state, resultNote } : a,
          );
          return { ...m, actions };
        });
        const action = cur[msgIdx]?.actions?.[actionIdx];
        if (action && (state === "applied" || state === "failed")) {
          next.push({
            role: "assistant",
            content:
              state === "applied"
                ? `✅ [user confirmed: ${resultNote ?? actionDetail(action)} — applied to Meta]`
                : `⚠️ [action failed: ${resultNote ?? "unknown error"} — nothing was changed]`,
          });
        }
        return next;
      });
    },
    [],
  );

  const empty = messages.length === 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 300px",
        gap: 24,
        alignItems: "start",
      }}
    >
      {/* ---- chat column ---- */}
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          background: "var(--surface)",
          boxShadow: "var(--shadow-sm)",
          display: "flex",
          flexDirection: "column",
          minHeight: isMobile ? 480 : 620,
          maxHeight: isMobile ? "72vh" : "78vh",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--surface-2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BrainMark />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Growth analyst</div>
              <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                reads live ad + RevenueCat data before it answers
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ModelToggle model={model} setModel={setModel} />
            {!empty && (
              <button
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                style={{
                  fontSize: 11.5,
                  padding: "5px 11px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                New chat
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: isMobile ? 14 : 22 }}>
          {empty ? (
            <div
              style={{
                padding: isMobile ? "26px 14px" : "44px 28px",
                textAlign: "center",
                borderRadius: 16,
                background:
                  "linear-gradient(160deg, color-mix(in oklab, var(--p-hailey) 22%, var(--surface)), color-mix(in oklab, var(--p-olivia) 15%, var(--surface)) 55%, color-mix(in oklab, var(--p-emma) 14%, var(--surface)))",
                border: "1px solid var(--line)",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  margin: "0 auto 14px",
                  borderRadius: 12,
                  background: "linear-gradient(135deg, var(--p-andrea), var(--p-emma), var(--p-olivia))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 6px 18px color-mix(in oklab, var(--p-emma) 35%, transparent)",
                }}
              >
                <span className="serif" style={{ color: "white", fontSize: 21, fontStyle: "italic" }}>g</span>
              </div>
              <div
                className="serif"
                style={{ fontSize: isMobile ? 24 : 30, letterSpacing: "-0.02em", marginBottom: 8 }}
              >
                DreamMe, meet your <em>growth brain</em>.
              </div>
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "0 auto 24px", maxWidth: 420, lineHeight: 1.55 }}>
                Ask anything about your paid social. It pulls the live numbers first — Meta creatives,
                RevenueCat trials, blended efficiency — then answers like a media buyer. It can even
                propose pauses and budget moves for you to approve.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520, margin: "0 auto" }}>
                {THOUGHT_STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    style={{
                      textAlign: "left",
                      padding: "11px 15px",
                      fontSize: 13,
                      lineHeight: 1.45,
                      borderRadius: 12,
                      border: "1px solid var(--line)",
                      background: "color-mix(in oklab, var(--surface) 80%, transparent)",
                      color: "var(--ink-2)",
                      cursor: "pointer",
                    }}
                  >
                    ✦ {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 18 }}>
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: "10px 15px",
                        borderRadius: "16px 16px 4px 16px",
                        background: "var(--ink)",
                        color: "var(--surface)",
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} style={{ display: "grid", gap: 8 }}>
                    {m.steps && m.steps.length > 0 && <StepTrace steps={m.steps} />}
                    <div
                      style={{
                        padding: "4px 2px",
                        borderLeft: "2px solid var(--line-2)",
                        paddingLeft: 14,
                      }}
                    >
                      <MarkdownLite text={m.content} />
                    </div>
                    {m.actions && m.actions.length > 0 && (
                      <div style={{ display: "grid", gap: 8, marginLeft: 16 }}>
                        {m.actions.map((a, ai) => (
                          <ActionCard
                            key={ai}
                            action={a}
                            onResolve={(state, resultNote) => resolveAction(i, ai, state, resultNote)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
              {sending && <ThinkingRow />}
            </div>
          )}
        </div>

        {error && (
          <div style={{ padding: "0 16px" }}>
            <ErrorBanner>
              {error}{" "}
              <button
                onClick={() => {
                  const lastUser = [...messages].reverse().find((m) => m.role === "user");
                  if (lastUser) {
                    setMessages((cur) => cur.slice(0, cur.lastIndexOf(lastUser)));
                    void send(lastUser.content);
                  }
                }}
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  padding: "2px 10px",
                  borderRadius: 999,
                  border: "1px solid color-mix(in oklab, var(--accent) 40%, var(--line))",
                  background: "var(--surface)",
                  color: "var(--accent)",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </ErrorBanner>
          </div>
        )}

        <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={sending ? "Analyzing…" : "Ask about your ads, spend, trials, creative strategy…"}
            rows={2}
            disabled={sending}
            style={{
              flex: 1,
              resize: "none",
              padding: "10px 13px",
              fontSize: 13.5,
              lineHeight: 1.5,
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              color: "var(--ink)",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={() => void send(input)}
            disabled={sending || !input.trim()}
            style={{
              alignSelf: "stretch",
              padding: "0 20px",
              borderRadius: 12,
              border: "1px solid var(--ink)",
              background: sending || !input.trim() ? "var(--surface-2)" : "var(--ink)",
              color: sending || !input.trim() ? "var(--ink-4)" : "var(--surface)",
              fontSize: 13,
              fontWeight: 600,
              cursor: sending || !input.trim() ? "default" : "pointer",
            }}
          >
            {sending ? "…" : "Ask"}
          </button>
        </div>
      </div>

      {/* ---- side rail: weekly recap ---- */}
      <RecapRail data={data} />
    </div>
  );
}

function BrainMark() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        background: "linear-gradient(135deg, var(--p-andrea), var(--p-emma), var(--p-olivia))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 3px 10px color-mix(in oklab, var(--p-emma) 30%, transparent)",
        flexShrink: 0,
      }}
    >
      <span className="serif" style={{ color: "white", fontSize: 15, fontStyle: "italic" }}>g</span>
    </div>
  );
}

function ModelToggle({ model, setModel }: { model: ModelId; setModel: (m: ModelId) => void }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        borderRadius: 999,
        border: "1px solid var(--line)",
        background: "var(--surface)",
      }}
    >
      {[MODELS.SONNET_4_6, MODELS.OPUS_4_7].map((m) => {
        const active = model === m;
        return (
          <button
            key={m}
            onClick={() => setModel(m)}
            title={`Answer with ${MODEL_LABELS[m]}`}
            style={{
              fontSize: 10.5,
              fontFamily: "var(--font-geist-mono), monospace",
              padding: "3px 9px",
              borderRadius: 999,
              border: "none",
              background: active ? "var(--ink)" : "transparent",
              color: active ? "var(--surface)" : "var(--ink-3)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {MODEL_LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

function StepTrace({ steps }: { steps: AgentStep[] }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {steps.map((s, i) => (
        <span
          key={i}
          title={s.summary}
          style={{
            fontSize: 10,
            fontFamily: "var(--font-geist-mono), monospace",
            padding: "3px 9px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--surface-2)",
            color: s.ok ? "var(--ink-3)" : "var(--accent)",
            whiteSpace: "nowrap",
          }}
        >
          ⚙ {s.tool} · {s.summary}
        </span>
      ))}
    </div>
  );
}

function ThinkingRow() {
  const [line, setLine] = React.useState("Pulling the numbers…");
  React.useEffect(() => {
    const lines = [
      "Pulling the numbers…",
      "Reading ad performance…",
      "Checking RevenueCat truth layer…",
      "Cross-referencing creatives…",
      "Writing it up…",
    ];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % lines.length;
      setLine(lines[i]);
    }, 3500);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink-3)", fontSize: 13 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--accent)",
          animation: "pulse 1.2s ease-in-out infinite",
        }}
      />
      <em className="serif" style={{ fontSize: 15 }}>{line}</em>
      <style>{`@keyframes pulse { 0%,100% { opacity: .3; transform: scale(.85);} 50% { opacity: 1; transform: scale(1);} }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly recap rail
// ---------------------------------------------------------------------------

function RecapRail({ data }: { data: GrowthData }) {
  const [history, setHistory] = React.useState<RecapResponse[]>([]);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingLine, setLoadingLine] = React.useState(RECAP_LOADING_LINES[0]);

  const recap = history[selectedIdx] ?? null;

  // DB history first; the pre-history localStorage copy is the fallback.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/growth/recap");
        const body = (await res.json()) as { recaps?: RecapResponse[] };
        if (alive && res.ok && body.recaps?.length) {
          setHistory(body.recaps);
          return;
        }
      } catch {}
      if (alive) {
        const saved = loadJSON<RecapResponse>(RECAP_KEY);
        if (saved) setHistory([saved]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!loading) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % RECAP_LOADING_LINES.length;
      setLoadingLine(RECAP_LOADING_LINES[i]);
    }, 3200);
    return () => clearInterval(id);
  }, [loading]);

  const thumbs = React.useMemo(() => {
    const aggs = aggregateAds(data.rows.filter((x) => x.date >= daysAgoISO(13)));
    const m = new Map<string, string>();
    for (const a of aggs.values()) m.set(a.ad_id, a.thumbnail);
    return m;
  }, [data.rows]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/growth/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as RecapResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setHistory((cur) => [body, ...cur]);
      setSelectedIdx(0);
      saveJSON(RECAP_KEY, body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          background:
            "linear-gradient(160deg, color-mix(in oklab, var(--p-hailey) 22%, var(--surface)), color-mix(in oklab, var(--p-olivia) 16%, var(--surface)))",
          boxShadow: "var(--shadow-sm)",
          padding: 18,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-3)",
            marginBottom: 6,
          }}
        >
          Weekly recap · one click
        </div>
        <div className="serif" style={{ fontSize: 20, letterSpacing: "-0.02em", marginBottom: 6 }}>
          Do your ad retro in one click
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 14px" }}>
          Top &amp; bottom performers with <strong>why · who · what next</strong>, creative patterns,
          and a prioritized action list.
        </p>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--ink-2)", fontSize: 13 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--accent)",
                animation: "pulse 1.2s ease-in-out infinite",
              }}
            />
            <em className="serif">{loadingLine}</em>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => void generate()}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 10,
                border: "1px solid var(--ink)",
                background: "var(--ink)",
                color: "var(--surface)",
                cursor: "pointer",
              }}
            >
              {recap ? "Regenerate recap" : "Generate this week's recap"}
            </button>
            {recap && (
              <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-geist-mono), monospace" }}>
                {timeAgo(recap.generated_at)}
              </span>
            )}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--accent)" }}>{error}</div>
        )}
      </div>

      {history.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {history.map((h, i) => {
            const active = i === selectedIdx;
            const label = h.week_start
              ? new Date(`${h.week_start}T00:00:00Z`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })
              : timeAgo(h.generated_at);
            return (
              <button
                key={h.id ?? i}
                onClick={() => setSelectedIdx(i)}
                style={{
                  padding: "4px 11px",
                  fontSize: 11.5,
                  fontFamily: "var(--font-geist-mono), monospace",
                  borderRadius: 999,
                  border: "1px solid",
                  borderColor: active ? "var(--ink)" : "var(--line)",
                  background: active ? "var(--ink)" : "var(--surface)",
                  color: active ? "var(--surface)" : "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {recap && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
            padding: 18,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {recap.source === "cron" && (
              <span
                style={{
                  fontSize: 9.5,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "2px 8px",
                  borderRadius: 999,
                  color: "var(--ink-3)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                }}
              >
                auto · Monday cron
              </span>
            )}
            {recap.sent_at && (
              <span
                style={{
                  fontSize: 9.5,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "2px 8px",
                  borderRadius: 999,
                  color: "color-mix(in oklab, var(--accent-2) 80%, var(--ink))",
                  background: "color-mix(in oklab, var(--accent-2) 14%, var(--surface))",
                  border: "1px solid color-mix(in oklab, var(--accent-2) 30%, var(--line))",
                }}
              >
                ✉ emailed
              </span>
            )}
          </div>
          <div className="serif" style={{ fontSize: 17, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
            {recap.recap.headline}
          </div>

          <RecapStatStrip stats={recap.stats} />

          <p style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, margin: 0 }}>
            {recap.recap.summary}
          </p>

          <RecapPerformers
                title="Top performers"
                tone="var(--accent-2)"
                icon="▲"
                performers={recap.recap.top_performers}
                statsAds={recap.stats.ads_this_week}
                thumbs={thumbs}
              />
              <RecapPerformers
                title="Bottom performers"
                tone="var(--accent)"
                icon="▼"
                performers={recap.recap.bottom_performers}
                statsAds={recap.stats.ads_this_week}
                thumbs={thumbs}
              />

              {recap.recap.patterns.length > 0 && (
                <div>
                  <SectionLabel>Creative patterns</SectionLabel>
                  <div style={{ display: "grid", gap: 8 }}>
                    {recap.recap.patterns.map((p, i) => (
                      <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-geist-mono), monospace",
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "var(--ink-3)",
                            marginRight: 8,
                          }}
                        >
                          {p.dimension}
                        </span>
                        <span style={{ color: "var(--ink-2)" }}>{p.finding}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {recap.recap.actions.length > 0 && (
                <div>
                  <SectionLabel>Next actions</SectionLabel>
                  <div style={{ display: "grid", gap: 8 }}>
                    {recap.recap.actions.map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                        <UrgencyBadge urgency={a.urgency} />
                        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          <strong style={{ color: "var(--ink)" }}>{a.title}</strong>{" "}
                          <span style={{ color: "var(--ink-3)" }}>{a.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
        </div>
      )}
    </div>
  );
}

function RecapStatStrip({ stats }: { stats: RecapResponse["stats"] }) {
  const t = stats.totals;
  const cptDelta =
    t.cost_per_trial != null && t.prev_cost_per_trial != null && t.prev_cost_per_trial > 0
      ? ((t.cost_per_trial - t.prev_cost_per_trial) / t.prev_cost_per_trial) * 100
      : null;
  const trialsDelta =
    t.prev_rc_trials > 0 ? ((t.rc_trials - t.prev_rc_trials) / t.prev_rc_trials) * 100 : null;
  const cell = (label: string, value: string, delta?: number | null, goodWhen?: "up" | "down") => (
    <div>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {delta !== undefined && <DeltaChip pct={delta ?? null} goodWhen={goodWhen} />}
      </div>
    </div>
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 12,
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
      }}
    >
      {cell("Spend", fmtUSD(t.spend), t.spend_delta_pct, "up")}
      {cell("Cost / trial", t.cost_per_trial != null ? fmtUSD(t.cost_per_trial) : "—", cptDelta, "down")}
      {cell("RC trials", fmtInt(t.rc_trials), trialsDelta, "up")}
      {cell("Revenue", fmtUSD(t.rc_revenue))}
      {cell("Launched", fmtInt(t.creatives_launched))}
    </div>
  );
}

function RecapPerformers({
  title,
  tone,
  icon,
  performers,
  statsAds,
  thumbs,
}: {
  title: string;
  tone: string;
  icon: string;
  performers: RecapPerformer[];
  statsAds: RecapStatsAd[];
  thumbs: Map<string, string>;
}) {
  if (performers.length === 0) return null;
  const byId = new Map(statsAds.map((a) => [a.ad_id, a]));
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: tone,
          marginBottom: 10,
        }}
      >
        {icon} {title}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {performers.map((p) => {
          const ad = byId.get(p.ad_id);
          return (
            <div
              key={p.ad_id}
              style={{
                border: "1px solid var(--line)",
                borderLeft: `3px solid ${tone}`,
                borderRadius: 12,
                padding: "12px 14px",
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Thumb src={thumbs.get(p.ad_id) ?? ""} name={ad?.ad_name ?? p.ad_id} size={42} radius={7} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    {ad?.ad_name ?? p.ad_id}
                  </div>
                  {ad && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-3)",
                        fontFamily: "var(--font-geist-mono), monospace",
                      }}
                    >
                      {fmtUSD(ad.spend)} spend
                      {ad.cost_per_trial != null ? ` · ${fmtUSD(ad.cost_per_trial)}/trial` : ""}
                      {ad.trial_starts ? ` · ${ad.trial_starts} trials` : ""}
                      {ad.hook_rate_pct != null ? ` · hook ${ad.hook_rate_pct}%` : ""}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
                <RecapLine tag="WHY" text={p.why} />
                <RecapLine tag="WHO" text={p.who} />
                <RecapLine tag="NEXT" text={p.what_next} strong />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecapLine({ tag, text, strong }: { tag: string; text: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 9.5,
          letterSpacing: "0.08em",
          color: "var(--ink-4)",
          paddingTop: 2,
          minWidth: 34,
        }}
      >
        {tag}
      </span>
      <span style={{ color: strong ? "var(--ink)" : "var(--ink-2)", fontWeight: strong ? 500 : 400 }}>
        {text}
      </span>
    </div>
  );
}

function UrgencyBadge({ urgency }: { urgency: "now" | "this_week" | "watch" }) {
  const map = {
    now: { label: "NOW", tone: "var(--accent)" },
    this_week: { label: "WEEK", tone: "var(--accent-2)" },
    watch: { label: "WATCH", tone: "var(--ink-4)" },
  } as const;
  const { label, tone } = map[urgency];
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--font-geist-mono), monospace",
        letterSpacing: "0.08em",
        padding: "3px 7px",
        borderRadius: 999,
        color: `color-mix(in oklab, ${tone} 80%, var(--ink))`,
        background: `color-mix(in oklab, ${tone} 14%, var(--surface))`,
        border: `1px solid color-mix(in oklab, ${tone} 30%, var(--line))`,
        whiteSpace: "nowrap",
        marginTop: 1,
      }}
    >
      {label}
    </span>
  );
}
