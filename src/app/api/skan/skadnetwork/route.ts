// SKAdNetwork postback collector. Apple POSTs here via the rewrite from
// /.well-known/skadnetwork/report-attribution/ (and the /skan-prefixed form).
// See docs/skan-diy-attribution.md.
import { collectPostback } from "@/lib/skan/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return collectPostback(req, "skadnetwork");
}
