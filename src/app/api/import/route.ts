import { POST as ingestionPost } from "../ingestion/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backward-compatible entry point. New callers should use /api/ingestion.
export async function POST(request: Request) {
  return ingestionPost(request);
}
