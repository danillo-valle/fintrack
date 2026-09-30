import { getHealth } from "@/lib/health";

// Sempre calculada na hora; nunca servida de cache
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getHealth());
}
