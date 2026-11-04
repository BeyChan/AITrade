const CONNECTOR_CREDENTIAL_ENV = [
  "KEEPA_API_KEY",
  "AMAZON_SP_API_CLIENT_SECRET",
  "AMAZON_SP_API_REFRESH_TOKEN",
  "SHOPIFY_ACCESS_TOKEN",
  "EBAY_CLIENT_SECRET",
  "TIKTOK_SHOP_APP_SECRET",
  "ALIBABA_1688_APP_SECRET",
] as const;

export function sanitizeConnectorError(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
  maxLength = 1_000,
) {
  let message = error instanceof Error ? error.message : String(error || "同步失败");
  for (const name of CONNECTOR_CREDENTIAL_ENV) {
    const secret = env[name]?.trim();
    if (secret && secret.length >= 4) message = message.replaceAll(secret, "[REDACTED]");
  }
  return message
    .replace(/([?&](?:key|token|api_key|access_token|refresh_token|client_secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .slice(0, maxLength);
}
