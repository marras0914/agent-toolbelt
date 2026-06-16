/**
 * Identity that RapidAPI gateway traffic runs as at the origin.
 *
 * RapidAPI handles per-buyer authentication, quota, and billing on its side. The
 * origin only needs to (a) trust that a call came through RapidAPI (verified via
 * the proxy secret in auth.ts) and (b) have a real client + api-key row to attach
 * usage to (usage_records FKs both client_id and api_key_id) on an uncapped tier
 * so the shared channel isn't throttled by per-client free/origin limits.
 *
 * Seeded lazily on first use and cached. Tier is "enterprise" (effectively
 * uncapped) since RapidAPI does the real metering.
 */

import { getClientByEmail, createClient, getClientApiKeys, createApiKey, updateClientTier } from "./db";

const GATEWAY_EMAIL = "rapidapi-gateway@agenttoolbelt.live";

let cached: { clientId: string; keyId: string } | null = null;

export function getRapidApiGatewayClient(): { clientId: string; keyId: string } {
  if (cached) return cached;

  let client = getClientByEmail(GATEWAY_EMAIL);
  if (!client) {
    client = createClient(GATEWAY_EMAIL, "RapidAPI Gateway", "enterprise");
  } else if (client.tier !== "enterprise") {
    updateClientTier(client.id, "enterprise");
  }

  const keys = getClientApiKeys(client.id);
  const active = keys.find((k: any) => k.is_active);
  const keyId = active ? active.id : createApiKey(client.id, "rapidapi-gateway").record.id;

  cached = { clientId: client.id, keyId };
  return cached;
}
