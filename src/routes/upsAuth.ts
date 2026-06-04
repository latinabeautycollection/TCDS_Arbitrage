import { Router } from "express";
import { readFileSync } from "fs";

const router = Router();

const UPS_REDIRECT_URI = process.env.UPS_REDIRECT_URI || "https://api.tcdsolutionsgroup.com/auth/ups/callback";
const UPS_AUTH_BASE = process.env.UPS_AUTH_BASE || "https://www.ups.com/lasso/login";

router.get("/auth/ups/start", async (_req, res) => {
  const clientId = process.env.UPS_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send("UPS_CLIENT_ID not configured");
  }
  const state = `ups:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const url =
    `${UPS_AUTH_BASE}` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(UPS_REDIRECT_URI)}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;
  return res.redirect(url);
});

router.get("/auth/ups/callback", async (req, res) => {
  console.log("[ups-callback]", JSON.stringify({ query: req.query, ts: new Date().toISOString() }));

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const error = typeof req.query.error === "string" ? req.query.error : "";

  if (error) {
    console.error("[ups-callback] OAuth error:", error);
    return res.status(400).send(`UPS OAuth error: ${error}`);
  }

  if (!code || !state) {
    return res.status(400).send("Missing code or state");
  }

  // TODO: wire token exchange when UPS_CLIENT_SECRET is configured.
  // Pattern will mirror exchangeCodeForToken() in services/ebayOAuth.ts,
  // and storage will mirror saveToken() in services/tokenStore.ts.
  console.log("[ups-callback] received code; token exchange wiring pending");

  try {
    const html = readFileSync(
      "/var/www/api.tcdsolutionsgroup.com/public/auth-ups-accepted.html",
      "utf-8",
    );
    return res.set("Content-Type", "text/html").send(html);
  } catch {
    return res.send(`
      <html>
        <body>
          <h1>UPS Authorization Received</h1>
          <p>Authorization code captured. Token exchange pending credential configuration.</p>
        </body>
      </html>
    `);
  }
});

export default router;
