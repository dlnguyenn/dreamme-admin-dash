/**
 * Second daily pass of /api/cron/aso-ranks, 15:00 UTC, for the terms the first
 * pass didn't reach. A separate hour on purpose: Vercel Hobby fires a cron
 * anywhere inside its hour, so two passes in one hour could overlap.
 */
import { GET as firstPass } from "../aso-ranks/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = firstPass;
