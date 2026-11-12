/**
 * Morning WhatsApp brief: yesterday's trials, revenue, ad spend and MRR, plus
 * the Overview's "Needs attention" items and what the experiment log wants.
 *
 * Vercel cron at 12:00 UTC (Hobby crons fire somewhere in that hour, so it
 * lands ~7-8am ET in winter, ~8-9am in summer), after the nightly syncs.
 *
 *   GET ?dry=1   build the message and return it without sending
 *
 * Setup and the template text to register: docs/whatsapp-daily-brief.md.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { buildOverview } from "@/lib/overview";
import { loadAndSyncExperimentLog } from "@/lib/experiment-log-sync";
import { buildDailyBrief } from "@/lib/daily-brief";
import { easternDate } from "@/lib/socialViews";
import { sendWhatsAppTemplate, whatsappConfig } from "@/lib/vendors/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const [overview, log] = await Promise.all([
    buildOverview(),
    loadAndSyncExperimentLog().then(
      (r) => ({ entries: r.entries, error: r.rcError }),
      (e) => ({ entries: null, error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);

  const brief = buildDailyBrief({
    overview,
    experiments: log.entries,
    experimentsError: log.entries ? log.error : null,
    today: easternDate(),
  });

  if (dry) {
    return NextResponse.json({ ok: true, dry: true, text: brief.text, params: brief.params, errors: overview.errors });
  }

  const { config, missing } = whatsappConfig();
  if (!config) {
    // Not set up yet (docs/whatsapp-daily-brief.md): skip without failing the cron.
    return NextResponse.json({
      ok: true,
      sent: [],
      note: `WhatsApp not configured (missing ${missing.join(", ")}); nothing sent`,
      text: brief.text,
    });
  }
  const sent = await sendWhatsAppTemplate(config, brief.params);
  const ok = sent.every((s) => s.ok);
  return NextResponse.json({ ok, sent, text: brief.text, errors: overview.errors }, { status: ok ? 200 : 502 });
}
