function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  allowedEmails: () =>
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ingestToken: () => required("INGEST_TOKEN"),
  n8nTriggerWebhookUrl: () => required("N8N_TRIGGER_WEBHOOK_URL"),
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return env.allowedEmails().includes(email.toLowerCase());
}
