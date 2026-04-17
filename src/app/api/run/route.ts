import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { env, isEmailAllowed } from "@/lib/env";

export const runtime = "nodejs";

export async function POST() {
  // ---- Auth: must be a signed-in, allow-listed user ----
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- Call N8N webhook ----
  let webhookOk = false;
  let webhookStatus = 0;
  let webhookBody = "";
  try {
    const res = await fetch(env.n8nTriggerWebhookUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggered_by: `manual:${user.email}`,
        source: "dreamme-admin-dash",
      }),
    });
    webhookOk = res.ok;
    webhookStatus = res.status;
    webhookBody = (await res.text()).slice(0, 500);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to reach N8N",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // ---- Log a workflow_runs row so the UI shows the trigger. ----
  const svc = createSupabaseServiceClient();
  const now = new Date().toISOString();
  await svc.from("workflow_runs").insert({
    triggered_by: `manual:${user.email}`,
    status: webhookOk ? "triggered" : "trigger_failed",
    started_at: now,
    finished_at: now,
  });

  if (!webhookOk) {
    return NextResponse.json(
      { error: "N8N returned non-2xx", status: webhookStatus, body: webhookBody },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
