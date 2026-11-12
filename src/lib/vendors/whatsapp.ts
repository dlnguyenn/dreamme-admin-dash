/**
 * WhatsApp Cloud API (Meta) — send an approved template message.
 *
 * A business can only START a conversation with a template; free text is
 * allowed only within 24h of the person messaging the number. The daily
 * brief always uses its template so it lands every morning regardless.
 *
 * Env (Vercel; never in code, the repo is public):
 *   WHATSAPP_TOKEN            system-user access token with whatsapp_business_messaging
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (WhatsApp Manager > API Setup)
 *   WHATSAPP_BRIEF_TO         recipients, E.164 digits, comma-separated
 *   WHATSAPP_BRIEF_TEMPLATE   template name (default daily_brief)
 *   WHATSAPP_BRIEF_LANG       template language code (default en_US)
 */
const API_VERSION = process.env.META_API_VERSION ?? "v22.0";

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  to: string[];
  template: string;
  lang: string;
}

export function whatsappConfig(): { config: WhatsAppConfig | null; missing: string[] } {
  const token = process.env.WHATSAPP_TOKEN ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const to = (process.env.WHATSAPP_BRIEF_TO ?? "")
    .split(",")
    .map((s) => s.replace(/[^\d]/g, ""))
    .filter(Boolean);
  const missing = [
    !token && "WHATSAPP_TOKEN",
    !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
    to.length === 0 && "WHATSAPP_BRIEF_TO",
  ].filter((x): x is string => !!x);
  if (missing.length) return { config: null, missing };
  return {
    config: {
      token,
      phoneNumberId,
      to,
      template: process.env.WHATSAPP_BRIEF_TEMPLATE || "daily_brief",
      lang: process.env.WHATSAPP_BRIEF_LANG || "en_US",
    },
    missing,
  };
}

export interface SendResult {
  /** Last 4 digits only, so logs and responses don't carry the number. */
  to: string;
  ok: boolean;
  messageId: string | null;
  error: string | null;
}

export async function sendWhatsAppTemplate(cfg: WhatsAppConfig, params: string[]): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const to of cfg.to) {
    const tail = `…${to.slice(-4)}`;
    try {
      const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: cfg.template,
            language: { code: cfg.lang },
            components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
          },
        }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number; error_data?: { details?: string } };
      };
      if (!res.ok || body.error) {
        const e = body.error;
        results.push({
          to: tail,
          ok: false,
          messageId: null,
          error: `WhatsApp ${res.status}${e?.code ? ` (${e.code})` : ""}: ${e?.error_data?.details ?? e?.message ?? "request failed"}`,
        });
      } else {
        results.push({ to: tail, ok: true, messageId: body.messages?.[0]?.id ?? null, error: null });
      }
    } catch (e) {
      results.push({ to: tail, ok: false, messageId: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
