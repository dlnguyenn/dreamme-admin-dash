import { describe, expect, it } from "vitest";
import {
  brokenConnectors,
  connectorAlerts,
  resolveFilter,
  type ConnectorStatus,
} from "@/lib/mmp/connector-health";

// The live 2026-11-06 shape from Singular's data_availability_status.
const facebookBroken: ConnectorStatus = {
  data_connector_id: "47a9fecd",
  data_connector_source_name: "Facebook",
  data_connector_username: "dln68@rutgers.edu",
  is_active_last_30_days: false,
  is_available: false,
  status: "login error",
};
const tracker: ConnectorStatus = { data_connector_id: "trk1", data_connector_source_name: "Singular Tracker", status: "data populated" };
const pending: ConnectorStatus = { data_connector_id: "p1", data_connector_source_name: "TikTok", status: "Data not populated" };

describe("brokenConnectors", () => {
  it("flags a login error and ignores populated or not-yet-populated connectors", () => {
    expect(brokenConnectors([facebookBroken, tracker, pending])).toEqual([facebookBroken]);
  });
  it("treats any unknown status as broken", () => {
    expect(brokenConnectors([{ ...tracker, status: "disabled" }])).toHaveLength(1);
  });
});

describe("connectorAlerts", () => {
  it("writes one critical account-scope alert per broken connector with the fix steps", () => {
    const [a] = connectorAlerts([facebookBroken], "2026-11-06");
    expect(a).toMatchObject({
      alert_date: "2026-11-06",
      scope: "account",
      campaign_id: "singular:47a9fecd",
      metric: "singular_connector",
      severity: "critical",
    });
    expect(a.message).toContain('"login error"');
    expect(a.message).toContain("Validate your credentials");
  });
});

describe("resolveFilter", () => {
  it("resolves every open connector alert when nothing is broken", () => {
    expect(resolveFilter([])).toBe("metric=eq.singular_connector&resolved_at=is.null");
  });
  it("keeps the still-broken connectors' alerts open", () => {
    const f = resolveFilter([facebookBroken]);
    expect(decodeURIComponent(f)).toBe('metric=eq.singular_connector&resolved_at=is.null&campaign_id=not.in.("singular:47a9fecd")');
  });
});
