import { loadStatsPayload } from "@/lib/stats-server";
import { jsonError, requireUser } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// The numbers behind Xếp hạng › Thống kê and the member pages (see lib/stats-server.ts), for any signed-in member.
export async function GET(request: Request) {
  try {
    const { admin } = await requireUser(request);
    return Response.json(await loadStatsPayload(admin));
  } catch (error) {
    return jsonError(error);
  }
}
