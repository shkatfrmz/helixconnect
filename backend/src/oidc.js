const GOOGLE = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
  scope: "openid email profile"
};

function entraUrls(tenant) {
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  return {
    auth: `${base}/authorize`,
    token: `${base}/token`,
    userinfo: "https://graph.microsoft.com/oidc/userinfo",
    graphMe: "https://graph.microsoft.com/v1.0/me",
    scope: "openid email profile User.Read"
  };
}

export function ssoProviders() {
  const googleId = process.env.USER_GOOGLE_CLIENT_ID || "";
  const entraId = process.env.USER_ENTRA_CLIENT_ID || "";
  const tenant = process.env.USER_ENTRA_TENANT || "common";
  return {
    google: {
      id: "google",
      label: "Google",
      enabled: Boolean(googleId && process.env.USER_GOOGLE_CLIENT_SECRET),
      clientId: googleId,
      clientSecret: process.env.USER_GOOGLE_CLIENT_SECRET || "",
      ...GOOGLE
    },
    entra: {
      id: "entra",
      label: "Microsoft",
      enabled: Boolean(entraId && process.env.USER_ENTRA_CLIENT_SECRET),
      clientId: entraId,
      clientSecret: process.env.USER_ENTRA_CLIENT_SECRET || "",
      tenant,
      ...entraUrls(tenant)
    }
  };
}

export function publicSsoStatus() {
  const all = ssoProviders();
  return {
    google: all.google.enabled,
    entra: all.entra.enabled
  };
}

export function publicOrigin(req) {
  const xfProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return (process.env.USER_OIDC_REDIRECT_BASE || `${proto}://${host}`).replace(/\/$/, "");
}

export function callbackUri(req, provider) {
  return `${publicOrigin(req)}/api/auth/${provider}/callback`;
}

export function authorizeUrl(req, provider, state) {
  const cfg = ssoProviders()[provider];
  if (!cfg?.enabled) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: callbackUri(req, provider),
    response_type: "code",
    scope: cfg.scope,
    state,
    prompt: "select_account"
  });
  if (provider === "google") params.set("access_type", "online");
  return `${cfg.auth}?${params.toString()}`;
}

export async function exchangeCode(req, provider, code) {
  const cfg = ssoProviders()[provider];
  if (!cfg?.enabled) throw new Error("SSO is not configured");
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: callbackUri(req, provider)
  });
  const tokenRes = await fetch(cfg.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || tokenJson.error || "Token exchange failed");
  }
  return profileFromTokens(provider, cfg, tokenJson);
}

async function profileFromTokens(provider, cfg, tokenJson) {
  if (provider === "google") {
    const res = await fetch(cfg.userinfo, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    const me = await res.json();
    if (!res.ok) throw new Error("Google profile failed");
    return {
      provider: "google",
      email: me.email,
      displayName: me.name || me.email,
      username: localPart(me.email)
    };
  }
  const res = await fetch(cfg.graphMe, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const me = await res.json();
  if (!res.ok) throw new Error("Microsoft Graph profile failed");
  const email = me.mail || me.userPrincipalName;
  return {
    provider: "entra",
    email,
    displayName: me.displayName || email,
    username: localPart(email)
  };
}

function localPart(email) {
  const base = String(email || "user")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return base || "user";
}
