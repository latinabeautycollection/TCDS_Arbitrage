import { getLatestActiveToken, setTokenError, updateTokenById } from "../services/tokenStore";
import { refreshAccessToken } from "../services/ebayOAuth";
import { EbayEnvironment } from "../config/ebay";

async function refreshEnvironment(environment: EbayEnvironment) {
  const current = await getLatestActiveToken(environment);
  if (!current || !current.refresh_token) {
    console.log(`No refreshable token found for ${environment}`);
    return;
  }

  const expiresAt = new Date(current.access_expires_at).getTime();
  const msRemaining = expiresAt - Date.now();

  if (msRemaining > 15 * 60 * 1000) {
    console.log(`${environment} token still healthy`);
    return;
  }

  try {
    const refreshed = await refreshAccessToken(environment, current.refresh_token);

    await updateTokenById(current.id, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      scope: refreshed.scope ?? current.scope ?? undefined,
      accessExpiresIn: refreshed.expires_in,
      refreshExpiresIn: refreshed.refresh_token_expires_in,
    });

    console.log(`Refreshed ${environment} token`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setTokenError(current.id, message);
    console.error(`Failed refreshing ${environment}:`, message);
  }
}

async function main() {
  await refreshEnvironment("production");
  await refreshEnvironment("sandbox");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
