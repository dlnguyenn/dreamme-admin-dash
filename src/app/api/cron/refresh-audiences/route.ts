import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  fetchPaidCustomersWithEmail,
  revenueCatConfigured,
} from "@/lib/vendors/revenuecat";
import {
  createCustomAudience,
  uploadEmailsToAudience,
  createLookalike,
  addCustomAudiencesToAdSet,
  metaAdsConfigured,
} from "@/lib/vendors/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — Hobby plan cap. RC enumeration may need pagination tuning to fit.

const DEFAULT_ACCOUNT_ID = "act_1575502753719515";

// Ad sets that receive the new lookalike automatically. Comic Sans control
// and Pay-for-Trial ad sets are intentionally excluded — their learning
// history is worth more than a fresh audience addition.
const TARGET_ADSETS = [
  { id: "120243985431000622", name: "AI Video Test" },
  { id: "120244041045720622", name: "Agency Video Test" },
];

const WINDOW_DAYS = 180;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!revenueCatConfigured()) {
    return NextResponse.json(
      { ok: false, error: "RevenueCat env not configured" },
      { status: 500 },
    );
  }
  if (!metaAdsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Meta env not configured" },
      { status: 500 },
    );
  }

  const accountId = process.env.META_AD_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
  const sinceMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  try {
    // 1. Pull paid customers
    log("Pulling paid customers from RC...");
    const paidUsers = await fetchPaidCustomersWithEmail({
      sinceMs,
      concurrency: 25,
      log,
    });
    if (paidUsers.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No paid users found with email", logs },
        { status: 200 },
      );
    }

    // 2. Create custom audience
    log(`Creating audience with ${paidUsers.length} hashed emails...`);
    const audience = await createCustomAudience({
      accountId,
      name: `DreamMe Paid Users (${WINDOW_DAYS}d, refreshed ${today})`,
      description: `Auto-refreshed monthly. ${paidUsers.length} customers with active entitlement in last ${WINDOW_DAYS}d. Apple-relay emails excluded.`,
    });
    log(`  audience ${audience.id}`);

    // 3. Upload hashed emails
    const upload = await uploadEmailsToAudience({
      audienceId: audience.id,
      emails: paidUsers.map((u) => u.email),
      log,
    });

    // 4. Wait for Meta ingestion before lookalike
    log("Waiting 30s for Meta ingestion...");
    await new Promise((r) => setTimeout(r, 30_000));

    // 5. Create 1% US lookalike
    const lookalike = await createLookalike({
      accountId,
      originAudienceId: audience.id,
      name: `LAL 1% US — DreamMe Paid Users (${WINDOW_DAYS}d, ${today})`,
      ratio: 0.01,
      country: "US",
    });
    log(`  lookalike ${lookalike.id}`);

    // 6. Apply lookalike to target ad sets
    const adsetResults: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];
    for (const adset of TARGET_ADSETS) {
      try {
        await addCustomAudiencesToAdSet({
          adsetId: adset.id,
          audienceIds: [lookalike.id],
        });
        adsetResults.push({ ...adset, ok: true });
        log(`  ✓ ${adset.name}`);
      } catch (e) {
        adsetResults.push({
          ...adset,
          ok: false,
          error: (e as Error).message.slice(0, 200),
        });
        log(`  ✗ ${adset.name}: ${(e as Error).message.slice(0, 100)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      paidUsersUploaded: upload.uploadedCount,
      uploadBatches: upload.batches,
      audienceId: audience.id,
      lookalikeId: lookalike.id,
      adsets: adsetResults,
      logs,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, logs },
      { status: 500 },
    );
  }
}
