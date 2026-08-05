/**
 * Merge one consumer app account into another (duplicate-account repair).
 *
 * Written for the Jul 25-26 outage fallout: users who were locked out
 * re-registered, so their history is split across two app_user_ids. This
 * moves the history the user would actually notice onto the account they
 * still use.
 *
 * Usage:
 *   npm run merge-accounts -- --from <uuid> --to <uuid>              # dry run
 *   npm run merge-accounts -- --from <uuid> --to <uuid> --execute    # writes
 *
 * Deliberately NOT a general tool: one pair per run, no bulk mode, and it
 * never deletes the source `users` row — a paid Stripe subscription and its
 * RevenueCat customer are keyed to that app_user_id, so removing it would
 * revoke access the user paid for.
 *
 * Required env (.env.local): CONSUMER_SUPABASE_URL, CONSUMER_SERVICE_ROLE_KEY.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import * as fs from "fs";
import * as path from "path";

const URL_ = process.env.CONSUMER_SUPABASE_URL ?? "";
const KEY = process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

/**
 * History the user would notice losing. Internal telemetry (activity_log,
 * health_sync_log, api_usage, debug_food_failures, user_activity_hours) and
 * device rows (push tokens, live-activity state) are deliberately excluded:
 * they carry collision risk and no user-facing benefit.
 */
const MOVE_TABLES = [
  "meals",
  "food_logs",
  "ai_chat_sessions",
  "ai_chat_messages",
  "pearl_transactions",
  "user_inventory",
  "side_effects_log",
  "body_log",
  "meal_templates",
  "injection_logs",
  "post_likes",
  "comments",
];

/** stats_daily metrics that are per-day totals and so add up across accounts. */
const STAT_METRICS = [
  "protein",
  "water",
  "fiber",
  "activity",
  "activity_steps",
  "activity_workout_minutes",
  "calories",
];

const args = process.argv.slice(2);
const arg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};
const EXECUTE = args.includes("--execute");
const FROM = arg("from") ?? "";
const TO = arg("to") ?? "";

async function sel<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T[]> {
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, {
    headers: H,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`${table} select ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

async function patch(table: string, query: string, body: unknown): Promise<number> {
  if (!EXECUTE) return -1;
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${table} patch ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return ((await res.json()) as unknown[]).length;
}

async function del(table: string, query: string): Promise<void> {
  if (!EXECUTE) return;
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { ...H, Prefer: "return=minimal" },
  });
  if (!res.ok) {
    throw new Error(`${table} delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

type Line = { table: string; moved: number; note: string };

async function main() {
  if (!URL_ || !KEY) throw new Error("CONSUMER_SUPABASE_URL / CONSUMER_SERVICE_ROLE_KEY not set");
  if (!FROM || !TO) throw new Error("--from and --to are required");
  if (FROM === TO) throw new Error("--from and --to are the same account");

  const users = await sel<{ id: string; email: string | null; display_name: string | null }>(
    "users",
    `id=in.(${FROM},${TO})&select=id,email,display_name`,
  );
  const from = users.find((u) => u.id === FROM);
  const to = users.find((u) => u.id === TO);
  if (!to) throw new Error(`destination account ${TO} has no users row — refusing`);
  console.error(
    `\n  ${EXECUTE ? "EXECUTE" : "DRY RUN"} — merging into "${to.display_name ?? "?"}" <${to.email}>\n` +
      `    from ${FROM} ${from ? `<${from.email}>` : "(no users row)"}\n` +
      `    to   ${TO}\n`,
  );

  // ---- snapshot everything we are about to touch, for rollback ------------
  const snapshot: Record<string, unknown[]> = {};
  for (const t of [...MOVE_TABLES, "stats_daily", "user_missions", "pearl_balances", "streaks"]) {
    snapshot[t] = await sel(t, `user_id=eq.${FROM}&select=*`);
  }
  snapshot["_destination_pearl_balances"] = await sel("pearl_balances", `user_id=eq.${TO}&select=*`);
  snapshot["_destination_streaks"] = await sel("streaks", `user_id=eq.${TO}&select=*`);
  snapshot["_destination_stats_daily"] = await sel("stats_daily", `user_id=eq.${TO}&select=*`);

  const dir = path.join(process.cwd(), "_merge-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = snapshot["_destination_pearl_balances"].length
    ? String((snapshot["_destination_pearl_balances"][0] as { updated_at?: string }).updated_at ?? "")
        .replace(/[:.]/g, "-")
    : "nostamp";
  const file = path.join(dir, `merge_${FROM.slice(0, 8)}_to_${TO.slice(0, 8)}_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ from: FROM, to: TO, snapshot }, null, 2));
  console.error(`  snapshot written: ${file}\n`);

  const lines: Line[] = [];

  // ---- straight repoints --------------------------------------------------
  for (const t of MOVE_TABLES) {
    const rows = snapshot[t] as unknown[];
    if (!rows.length) {
      lines.push({ table: t, moved: 0, note: "nothing to move" });
      continue;
    }
    try {
      await patch(t, `user_id=eq.${FROM}`, { user_id: TO });
      lines.push({ table: t, moved: rows.length, note: "moved" });
    } catch (e) {
      lines.push({ table: t, moved: 0, note: `FAILED: ${e instanceof Error ? e.message : e}` });
    }
  }

  // ---- stats_daily: one row per (user, date); same-day rows are halves of
  //      the same real day, so their totals add.
  try {
    const src = snapshot["stats_daily"] as Array<Record<string, unknown>>;
    const dst = snapshot["_destination_stats_daily"] as Array<Record<string, unknown>>;
    const dstByDate = new Map(dst.map((r) => [String(r.date), r]));
    const clean = src.filter((r) => !dstByDate.has(String(r.date)));
    const clash = src.filter((r) => dstByDate.has(String(r.date)));

    if (clean.length) {
      await patch(
        "stats_daily",
        `id=in.(${clean.map((r) => r.id).join(",")})`,
        { user_id: TO },
      );
    }
    for (const r of clash) {
      const target = dstByDate.get(String(r.date))!;
      const summed: Record<string, number> = {};
      for (const m of STAT_METRICS) {
        summed[m] = (Number(target[m]) || 0) + (Number(r[m]) || 0);
      }
      await patch("stats_daily", `id=eq.${target.id}`, summed);
      await del("stats_daily", `id=eq.${r.id}`);
    }
    lines.push({
      table: "stats_daily",
      moved: clean.length,
      note: clash.length
        ? `${clash.length} same-day row(s) summed into destination (${clash.map((r) => r.date).join(", ")})`
        : "moved",
    });
  } catch (e) {
    lines.push({ table: "stats_daily", moved: 0, note: `FAILED: ${e instanceof Error ? e.message : e}` });
  }

  // ---- user_missions: keyed (mission_id, period_start); move only the
  //      periods the destination doesn't already have.
  try {
    const src = snapshot["user_missions"] as Array<Record<string, unknown>>;
    const dst = await sel<Record<string, unknown>>(
      "user_missions",
      `user_id=eq.${TO}&select=mission_id,period_start`,
    );
    const have = new Set(dst.map((r) => `${r.mission_id}|${r.period_start}`));
    const movable = src.filter((r) => !have.has(`${r.mission_id}|${r.period_start}`));
    if (movable.length) {
      await patch(
        "user_missions",
        `id=in.(${movable.map((r) => r.id).join(",")})`,
        { user_id: TO },
      );
    }
    lines.push({
      table: "user_missions",
      moved: movable.length,
      note: `${src.length - movable.length} left behind (destination already has that period)`,
    });
  } catch (e) {
    lines.push({ table: "user_missions", moved: 0, note: `FAILED: ${e instanceof Error ? e.message : e}` });
  }

  // ---- pearls: real currency she earned on both sides, so it adds up ------
  try {
    const a = (snapshot["pearl_balances"] as Array<Record<string, number>>)[0];
    const b = (snapshot["_destination_pearl_balances"] as Array<Record<string, number>>)[0];
    if (a && b) {
      const merged = {
        balance: (Number(b.balance) || 0) + (Number(a.balance) || 0),
        lifetime_earned: (Number(b.lifetime_earned) || 0) + (Number(a.lifetime_earned) || 0),
        lifetime_spent: (Number(b.lifetime_spent) || 0) + (Number(a.lifetime_spent) || 0),
      };
      await patch("pearl_balances", `user_id=eq.${TO}`, merged);
      await del("pearl_balances", `user_id=eq.${FROM}`);
      lines.push({
        table: "pearl_balances",
        moved: 1,
        note: `balance ${b.balance}+${a.balance} = ${merged.balance}, lifetime ${merged.lifetime_earned}/${merged.lifetime_spent}`,
      });
    } else {
      lines.push({ table: "pearl_balances", moved: 0, note: "one side missing — skipped" });
    }
  } catch (e) {
    lines.push({ table: "pearl_balances", moved: 0, note: `FAILED: ${e instanceof Error ? e.message : e}` });
  }

  // ---- streaks: keep the destination's live streak, but preserve the real
  //      personal best from before the split.
  try {
    const a = (snapshot["streaks"] as Array<Record<string, number>>)[0];
    const b = (snapshot["_destination_streaks"] as Array<Record<string, number>>)[0];
    if (a && b) {
      const longest = Math.max(Number(a.longest_streak) || 0, Number(b.longest_streak) || 0);
      await patch("streaks", `user_id=eq.${TO}`, { longest_streak: longest });
      await del("streaks", `user_id=eq.${FROM}`);
      lines.push({
        table: "streaks",
        moved: 1,
        note: `longest_streak max(${a.longest_streak}, ${b.longest_streak}) = ${longest}; current stays ${b.current_streak}`,
      });
    } else {
      lines.push({ table: "streaks", moved: 0, note: "one side missing — skipped" });
    }
  } catch (e) {
    lines.push({ table: "streaks", moved: 0, note: `FAILED: ${e instanceof Error ? e.message : e}` });
  }

  // ---- report -------------------------------------------------------------
  console.log("\n  table                  rows  note");
  console.log("  ---------------------- ----  ------------------------------------------");
  for (const l of lines) {
    console.log(`  ${l.table.padEnd(22)} ${String(l.moved).padStart(4)}  ${l.note}`);
  }
  const total = lines.reduce((s, l) => s + Math.max(0, l.moved), 0);
  const failed = lines.filter((l) => l.note.startsWith("FAILED"));
  console.log(`\n  ${EXECUTE ? "moved" : "would move"} ${total} rows` + (failed.length ? `  —  ${failed.length} TABLE(S) FAILED` : ""));
  if (!EXECUTE) console.log("  (dry run — nothing was written. re-run with --execute)\n");
  else console.log(`  rollback data: ${file}\n`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
