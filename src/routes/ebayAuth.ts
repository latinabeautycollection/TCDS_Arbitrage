import { Router } from "express";
import { env } from "../config/env";
import { EbayEnvironment } from "../config/ebay";
import { buildConsentUrl, buildState, exchangeCodeForToken } from "../services/ebayOAuth";
import { saveToken } from "../services/tokenStore";
import { readFileSync } from "fs";
import { getEbayConfig } from "../config/ebay";
const router = Router();

router.get("/auth-ebay-accepted.html", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  // No code → just serve the static success page (direct nav case)
  if (!code || !state) {
    try {
      const html = readFileSync("/var/www/api.tcdsolutionsgroup.com/public/auth-ebay-accepted.html", "utf-8");
      return res.set("Content-Type", "text/html").send(html);
    } catch {
      return res.send("<html><body><h1>Authorization Successful</h1></body></html>");
    }
  }

  // Has code → run the OAuth callback logic
  try {
    const [environmentRaw] = state.split(":");
    const environment: EbayEnvironment =
      environmentRaw === "production" ? "production" : "sandbox";

    console.log("[ebay-callback-via-accepted]", { has_code: !!code, env: environment });
    const token = await exchangeCodeForToken(environment, code);
    console.log("[ebay-callback-via-accepted] exchange ok", { has_refresh: !!token.refresh_token });

    await saveToken({
      environment,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope ?? getEbayConfig(environment).scopes,
      accessExpiresIn: token.expires_in,
      refreshExpiresIn: token.refresh_token_expires_in,
      accountLabel: `${environment}-manual-connect`,
    });
    console.log("[ebay-callback-via-accepted] saveToken ok");

    // Serve the same success page
    try {
      const html = readFileSync("/var/www/api.tcdsolutionsgroup.com/public/auth-ebay-accepted.html", "utf-8");
      return res.set("Content-Type", "text/html").send(html);
    } catch {
      return res.send("<html><body><h1>Authorization Successful</h1></body></html>");
    }
  } catch (err) {
    console.error("[ebay-callback-via-accepted] failed", err);
    return res.status(500).send("OAuth callback failed");
  }
});

router.get("/auth/ebay/start/:environment", async (req, res) => {
  const environment: EbayEnvironment =
    req.params.environment === "production" ? "production" : "sandbox";

  const state = buildState(environment);
  const url = buildConsentUrl(environment, state);
  return res.redirect(url);
});

router.get("/auth/ebay/callback", async (req, res) => {
    console.log("[ebay-callback]", JSON.stringify({ query: req.query, ts: new Date().toISOString() }));
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const error = typeof req.query.error === "string" ? req.query.error : "";

    if (error) {
      return res.redirect(env.EBAY_DECLINED_URL);
    }

    if (!code || !state) {
      return res.status(400).send("Missing code or state");
    }

    const [environmentRaw] = state.split(":");
    const environment: EbayEnvironment =
      environmentRaw === "production" ? "production" : "sandbox";

    const token = await exchangeCodeForToken(environment, code);
    console.log("[ebay-callback] exchange ok", { has_refresh: !!token.refresh_token, expires_in: token.expires_in });
    await saveToken({
      environment,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
scope: token.scope ?? getEbayConfig(environment).scopes,
      accessExpiresIn: token.expires_in,
      refreshExpiresIn: token.refresh_token_expires_in,
      accountLabel: `${environment}-manual-connect`,
    });
    console.log("[ebay-callback] saveToken ok, redirecting to accepted");
    return res.redirect(env.EBAY_ACCEPTED_URL);
  } catch (err) {
    console.error(err);
    return res.status(500).send("OAuth callback failed");
  }
});

export default router;
