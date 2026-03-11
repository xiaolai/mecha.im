import { z } from "zod";
import { isValidUrl } from "../../shared/validation.js";

const headscaleResponseSchema = z.object({
  machines: z.array(z.object({
    name: z.string(),
    ipAddresses: z.array(z.string()).default([]),
    online: z.boolean().default(false),
    forcedTags: z.array(z.string()).optional(),
  })),
});

export async function listBots(): Promise<Array<{
  name: string;
  ip: string;
  status: string;
}>> {
  const headscaleUrl = process.env.MECHA_HEADSCALE_URL;
  const headscaleApiKey = process.env.MECHA_HEADSCALE_API_KEY;

  if (!headscaleUrl || !headscaleApiKey) {
    return [{ name: "(unknown)", ip: "(no headscale)", status: "error: MECHA_HEADSCALE_URL and MECHA_HEADSCALE_API_KEY required" }];
  }

  if (!isValidUrl(headscaleUrl)) {
    return [{ name: "(error)", ip: "", status: "error: MECHA_HEADSCALE_URL is not a valid http(s) URL" }];
  }

  try {
    const resp = await fetch(`${headscaleUrl}/api/v1/machine`, {
      headers: { Authorization: `Bearer ${headscaleApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return [{ name: "(error)", ip: "", status: `Headscale API returned ${resp.status}` }];
    }

    const raw = await resp.json();
    const parsed = headscaleResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return [{ name: "(error)", ip: "", status: "Headscale API returned unexpected response shape" }];
    }

    return parsed.data.machines
      .filter((m) => m.forcedTags?.includes("tag:mecha-bot") || m.name.startsWith("mecha-"))
      .map((m) => ({
        name: m.name.replace(/^mecha-/, ""),
        ip: m.ipAddresses[0] ?? "",
        status: m.online ? "online" : "offline",
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [{ name: "(error)", ip: "", status: `Headscale unavailable: ${msg}` }];
  }
}
