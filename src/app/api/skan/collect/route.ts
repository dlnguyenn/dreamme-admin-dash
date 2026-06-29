// Collector status probe (GET /skan) + a defensive POST fallback.
//
// The per-network postback routes are /api/skan/skadnetwork and
// /api/skan/adattributionkit (the network is in the path so it survives the
// well-known rewrites). This route backs GET /skan for health/status, and
// accepts a POST as a skadnetwork fallback in case a rewrite ever lands here.
import { collectPostback, collectorStatus } from "@/lib/skan/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return collectorStatus();
}

export async function POST(req: Request) {
  return collectPostback(req, "skadnetwork");
}
