// Singular data connector health. Singular's Facebook connector logs in as
// Dan; a Facebook security checkpoint on his account (2026-09-25) killed its
// login and Singular silently stopped getting Meta cost for six weeks. The
// daily sync-singular run now asks Singular for every connector's status and
// raises a critical marketing alert (shown on the Overview) while one is broken.
//
// Pure helpers here; the fetch lives in src/lib/vendors/singular.ts.

export type ConnectorStatus = {
  data_connector_id: string;
  data_connector_source_name: string;
  data_connector_username?: string | null;
  is_active_last_30_days?: boolean;
  is_available?: boolean;
  status: string;
};

export const CONNECTOR_ALERT_METRIC = "singular_connector";

// Statuses that mean "the connector works, data may just not be in yet".
// Anything else ("login error", disabled, unconfigured, ...) is broken. Only
// "data populated" and "data not populated" appear in Singular's docs; "login
// error" was seen live on 2026-11-06.
const HEALTHY = new Set(["data populated", "data not populated", "pending", "in progress"]);

export function brokenConnectors(list: ConnectorStatus[]): ConnectorStatus[] {
  return list.filter((c) => !HEALTHY.has((c.status ?? "").trim().toLowerCase()));
}

export const connectorAlertId = (c: ConnectorStatus): string => `singular:${c.data_connector_id}`;

export type ConnectorAlert = {
  alert_date: string;
  scope: "account";
  campaign_id: string;
  campaign_name: string;
  metric: typeof CONNECTOR_ALERT_METRIC;
  value: number;
  baseline: number;
  z: number;
  direction: "drop";
  severity: "critical";
  message: string;
};

export function connectorAlerts(broken: ConnectorStatus[], alertDate: string): ConnectorAlert[] {
  return broken.map((c) => {
    const source = c.data_connector_source_name || "A";
    const who = c.data_connector_username ? ` (${c.data_connector_username})` : "";
    return {
      alert_date: alertDate,
      scope: "account",
      campaign_id: connectorAlertId(c),
      campaign_name: `Singular: ${source}`,
      metric: CONNECTOR_ALERT_METRIC,
      value: 0,
      baseline: 0,
      z: 0,
      direction: "drop",
      severity: "critical",
      message:
        `Singular's ${source} connector${who} says "${c.status}", so Singular is getting no ${source} data. ` +
        `Fix: Singular > Data Integrations > Data Connectors, turn on "Show connectors without data in the last 30 days", then click Validate your credentials on the ${source} row.`,
    };
  });
}

/** PostgREST filter that matches open connector alerts for connectors that are no longer broken. */
export function resolveFilter(broken: ConnectorStatus[]): string {
  const base = `metric=eq.${CONNECTOR_ALERT_METRIC}&resolved_at=is.null`;
  if (!broken.length) return base;
  const ids = broken.map((c) => `"${connectorAlertId(c).replace(/"/g, "")}"`).join(",");
  return `${base}&campaign_id=not.in.(${encodeURIComponent(ids)})`;
}
