"use client";

/**
 * The per-user flag for the Paywall X test: a small "X test: close_x" chip
 * wherever the DAD shows one user. Renders nothing while loading, when the
 * user isn't in the test, or when the lookup fails (it must never get in the
 * way of the card it sits on). Clicking opens the readout.
 *
 * Data: GET /api/experiment-readouts/paywall-close-x/user/<app_user_id>
 * (the exposure row in experiment_assignments, else the RevenueCat attribute).
 */
import * as React from "react";
import { ArmChip } from "./PaywallXReadout";
import { PAYWALL_X_READOUT_URL, chipTitle, type PaywallXUserArm } from "@/lib/paywall-x/shared";

const cache = new Map<string, Promise<PaywallXUserArm | null>>();

function lookup(appUserId: string): Promise<PaywallXUserArm | null> {
  let hit = cache.get(appUserId);
  if (!hit) {
    hit = fetch(`/api/experiment-readouts/paywall-close-x/user/${encodeURIComponent(appUserId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j?.ok ? (j.arm as PaywallXUserArm | null) : null))
      .catch(() => null);
    cache.set(appUserId, hit);
  }
  return hit;
}

export function PaywallXChip({ appUserId }: { appUserId: string | null | undefined }) {
  const [arm, setArm] = React.useState<PaywallXUserArm | null>(null);
  React.useEffect(() => {
    setArm(null);
    if (!appUserId) return;
    let live = true;
    lookup(appUserId).then((a) => live && setArm(a));
    return () => {
      live = false;
    };
  }, [appUserId]);
  if (!arm) return null;
  return (
    <a href={PAYWALL_X_READOUT_URL} style={{ textDecoration: "none", alignSelf: "flex-start" }}>
      <ArmChip arm={arm.arm} prefix="X test: " title={chipTitle(arm)} />
    </a>
  );
}
