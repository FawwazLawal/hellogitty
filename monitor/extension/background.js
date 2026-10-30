// HelloGitty service worker: signs in, fetches the work board every five minutes, classifies it
// with the Go classifier (board.wasm) and keeps the toolbar badge on the Your move count.
//
// chrome.storage.local holds
//   auth     {token, via: "token" | "device", login, refresh, expiresAt}
//   settings {maintain: ["owner/name" | "org"]}
//   board    the classified board from board.wasm, kept when a refresh fails
//   status   {checkedAt, error, errorAt}
//   signin   {expired: true} after GitHub stops accepting the sign-in, until the next sign-in
//   notify   {state: "ok", rows: {"owner/name#123": {new, what}}} unread notifications by board row,
//            or {state: "off", note} when the token can't read notifications
// chrome.storage.session holds the device sign-in, which lasts minutes and never touches disk:
//   device   {userCode, uri, expiresIn, expiresAt, ..., error, reason: "expired" | "denied" | "failed"}

importScripts("config.js", "wasm_exec.js");

const API = "https://api.github.com/graphql";
const NOTIFICATIONS = "https://api.github.com/notifications?per_page=50";
const ALARM = "refresh";
const PERIOD_MINUTES = 5;
const FINISHED_DAYS = 30;
// The badge takes the dashboard's dark-theme --caution-fill and --caution-ink. A service worker has
// no page, so it can't read the stylesheet's variables; these copy them. The toolbar badge is
// Chrome's, drawn the same in every page theme, so one pair is enough.
const CAUTION_FILL = "#e9aa3b";
const CAUTION_INK = "#160e02";

// --- classifier --------------------------------------------------------------------------------

let ready;

// classifier starts board.wasm once per service worker lifetime. Its main registers
// globalThis.hellogitty and then blocks, so go.run is never awaited.
function classifier() {
  if (!ready) {
    ready = (async () => {
      const go = new Go();
      const { instance } = await WebAssembly.instantiateStreaming(fetch("board.wasm"), go.importObject);
      go.run(instance);
      return self.hellogitty;
    })();
    ready.catch(() => { ready = undefined; });
  }
  return ready;
}

// --- GitHub ------------------------------------------------------------------------------------

class AuthError extends Error {}

async function graphql(token, query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: "bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    throw new AuthError(body.message || `${res.status} ${res.statusText}`.trim());
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim());
  return res.text();
}

// The dashboard's words for why a notification arrived (internal/notify Words).
const REASON_WORDS = {
  comment: "New comment", mention: "Mentioned you", team_mention: "Mentioned you", review_requested: "Review requested",
  assign: "Assigned to you", state_change: "Opened, closed or merged", security_alert: "Security alert",
  approval_requested: "Approval requested", ci_activity: "CI activity",
};

// unreadNotifications reads the newest 50 unread notification threads and keys each pull request
// or issue the way board rows are keyed, keeping the newest per row: {new: unix seconds, what}.
// It never marks anything read. Fine-grained tokens and GitHub App sign-ins can't read
// notifications at all, and an OAuth or classic token needs the notifications or repo scope;
// GitHub answers those with 401, 403 or 404, and the board goes on without New markers. via is
// how the user signed in, so the note can say what would turn the markers on.
const NOTIFY_OFF = {
  device: "This sign-in can't read GitHub notifications, so nothing is marked New. Sign out and sign in with GitHub again to allow it.",
  web: "Sign-ins through the HelloGitty GitHub App can't read notifications, so nothing is marked New. A classic token with the notifications or repo scope can.",
  token: "This token can't read GitHub notifications, so nothing is marked New. Fine-grained tokens never can; a classic token with the notifications or repo scope can.",
};
async function unreadNotifications(token, via) {
  const res = await fetch(NOTIFICATIONS, {
    headers: { Authorization: "bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return { state: "off", note: NOTIFY_OFF[via] || NOTIFY_OFF.token };
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim());
  const rows = {};
  for (const t of await res.json()) {
    const s = t.subject || {};
    if (!t.unread || (s.type !== "PullRequest" && s.type !== "Issue") || !t.repository) continue;
    const number = Number((s.url || "").split("/").pop());
    if (!number) continue;
    const k = t.repository.full_name.toLowerCase() + "#" + number;
    const at = Math.floor(Date.parse(t.updated_at) / 1000) || 0;
    if (!rows[k] || at > rows[k].new) rows[k] = { new: at, what: REASON_WORDS[t.reason] || "New activity" };
  }
  return { state: "ok", rows };
}

async function viewerLogin(token) {
  const body = JSON.parse(await graphql(token, "query { viewer { login } }"));
  const login = body.data && body.data.viewer && body.data.viewer.login;
  if (!login) throw new Error("Couldn't read your GitHub login" + (body.errors ? ": " + body.errors[0].message : ""));
  return login;
}

// --- refresh -----------------------------------------------------------------------------------

let running;

function refresh() {
  if (!running) running = doRefresh().finally(() => { running = undefined; });
  return running;
}

async function doRefresh() {
  const { auth, settings } = await chrome.storage.local.get(["auth", "settings"]);
  if (!auth || !auth.token) {
    await setBadge(0);
    return;
  }
  const now = new Date().toISOString();
  const maintain = (settings && settings.maintain) || [];
  try {
    let token = await freshToken(false);
    let login = auth.login;
    if (!login) {
      login = await viewerLogin(token);
      await chrome.storage.local.set({ auth: { ...auth, login } });
    }
    const hg = await classifier();
    const req = JSON.parse(hg.requests(JSON.stringify({ login, maintain, finishedDays: FINISHED_DAYS, now })));
    if (req.error) throw new Error(req.error);
    // The board draws from eight searches. Running them in one request shared a resource budget
    // and silently nulled nested fields such as the check status when it tipped over, so each
    // search goes in its own request. Running them in sequence mirrors the server (fetch.go)
    // and keeps a 401-and-renew retry simple: one token for the whole refresh.
    const bodies = [];
    let renewed = false;
    for (const r of req.requests) {
      let body;
      try {
        body = await graphql(token, r.query, r.variables);
      } catch (e) {
        if (!(e instanceof AuthError) || !auth.refresh || renewed) throw e;
        renewed = true;
        token = await freshToken(true);
        body = await graphql(token, r.query, r.variables);
      }
      bodies.push({ name: r.name, body });
    }
    const out = JSON.parse(hg.boardMulti(JSON.stringify({ login, maintain, scope: req.scope, now }), JSON.stringify(bodies)));
    // GitHub repeats an error once per search in the query; show each message once.
    const error = out.error ? [...new Set(out.error.split("; "))].join("; ") : "";
    const update = { status: { checkedAt: now, error, errorAt: error ? now : "" } };
    if (out.board) update.board = out.board;
    // New markers are extra: when GitHub can't be reached for them, keep the last ones and the board.
    try { update.notify = await unreadNotifications(token, auth.via); } catch (e) {}
    await chrome.storage.local.set(update);
    if (out.board) await setBadge(out.board.you.length);
  } catch (e) {
    if (e instanceof AuthError) {
      await signOut();
      await chrome.storage.local.set({ signin: { expired: true, reason: e.message } });
      return;
    }
    const { status } = await chrome.storage.local.get("status");
    await chrome.storage.local.set({ status: { ...(status || {}), checkedAt: now, error: e.message, errorAt: now } });
  }
}

async function setBadge(n) {
  await chrome.action.setBadgeBackgroundColor({ color: CAUTION_FILL });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: CAUTION_INK });
  await chrome.action.setBadgeText({ text: n > 0 ? (n > 99 ? "99+" : String(n)) : "" });
  await chrome.action.setTitle({ title: n > 0 ? `HelloGitty: ${n} waiting on you` : "HelloGitty" });
}

function schedule() {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: PERIOD_MINUTES });
  });
}

// --- sign-in -----------------------------------------------------------------------------------

// signIn stores a token after checking it with GitHub. granted is the device flow's token
// response, which carries a refresh token when the OAuth app has "Expire user access tokens" on.
async function signIn(token, via, granted) {
  token = (token || "").trim();
  if (!token) throw new Error("Paste a token first.");
  const login = await viewerLogin(token);
  await chrome.storage.local.set({ auth: { via, login, ...tokenFields(granted || { access_token: token }) }, status: {} });
  await chrome.storage.local.remove(["board", "signin", "notify"]);
  schedule();
  refresh();
  return login;
}

function tokenFields(r) {
  return {
    token: r.access_token,
    refresh: r.refresh_token || "",
    expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : 0,
  };
}

// freshToken returns a usable access token. An expiring token from the device flow is renewed a
// minute before it lapses, or at once when force is set; GitHub renews device-flow tokens with the
// client ID alone, no secret. A pasted token is returned as it is.
let renewing;
async function freshToken(force) {
  if (renewing) return renewing;
  const { auth } = await chrome.storage.local.get("auth");
  const due = auth.expiresAt && Date.now() > auth.expiresAt - 60 * 1000;
  if (!auth.refresh || !(force || due)) return auth.token;
  renewing = (async () => {
    const r = await form(ACCESS_TOKEN, {
      client_id: self.HELLOGITTY_CONFIG.OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.refresh,
    });
    if (r.error || !r.access_token) {
      throw new AuthError(r.error_description || r.error || "Your GitHub sign-in expired. Sign in again.");
    }
    const next = { ...auth, ...tokenFields(r) };
    await chrome.storage.local.set({ auth: next });
    return next.token;
  })().finally(() => { renewing = undefined; });
  return renewing;
}

async function signOut() {
  await chrome.storage.local.remove(["auth", "board", "status", "signin", "notify"]);
  await chrome.storage.session.remove("device");
  await setBadge(0);
}

// The OAuth device flow: GitHub shows the user a code to enter at github.com/login/device, and
// the extension polls until they approve it. It needs only the public client ID.
const DEVICE_CODE = "https://github.com/login/device/code";
const ACCESS_TOKEN = "https://github.com/login/oauth/access_token";

async function form(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim());
  return res.json();
}

// --- web auth flow (one-click, needs the exchange server) -------------------------------------

async function webSignIn() {
  const id = self.HELLOGITTY_CONFIG.OAUTH_CLIENT_ID;
  const exchangeURL = self.HELLOGITTY_CONFIG.OAUTH_EXCHANGE_URL;
  if (!id || !exchangeURL) throw new Error("Web auth flow is not configured.");
  const redirectURL = chrome.identity.getRedirectURL();
  const params = {
    client_id: id,
    redirect_uri: redirectURL,
    state: crypto.randomUUID(),
  };
  // GitHub Apps ignore OAuth scopes (permissions are set in the app registration). Only
  // "offline_access" is accepted, which enables expiring tokens with refresh. The device
  // flow still sends OAUTH_SCOPE for backward compatibility with OAuth Apps.
  if (exchangeURL) params.scope = "offline_access";
  const authURL = "https://github.com/login/oauth/authorize?" + new URLSearchParams(params);
  let responseURL;
  try {
    responseURL = await chrome.identity.launchWebAuthFlow({ url: authURL, interactive: true });
  } catch (e) {
    throw new Error(e.message === "The user did not approve access."
      ? "You closed the sign-in window. Click Try again when you're ready."
      : "Could not open the sign-in window: " + e.message);
  }
  const u = new URL(responseURL);
  if (u.searchParams.get("error")) {
    throw new Error(u.searchParams.get("error_description") || u.searchParams.get("error"));
  }
  const code = u.searchParams.get("code");
  if (!code) throw new Error("GitHub did not return an authorization code.");
  const res = await fetch(exchangeURL.replace(/\/$/, "") + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || body.error || `Exchange failed (${res.status})`);
  }
  const granted = await res.json();
  if (granted.error || !granted.access_token) {
    throw new Error(granted.error_description || granted.error || "Token exchange failed.");
  }
  await signIn(granted.access_token, "web", granted);
}

// deviceStart asks GitHub for a code. A failure is kept as the device's error, so the sign-in
// screen can show what went wrong.
async function deviceStart() {
  const id = self.HELLOGITTY_CONFIG.OAUTH_CLIENT_ID;
  if (!id) throw new Error("This build has no OAuth client ID; paste a token instead.");
  let r;
  try {
    r = await form(DEVICE_CODE, { client_id: id, scope: self.HELLOGITTY_CONFIG.OAUTH_SCOPE });
    if (r.error) throw new Error(r.error_description || r.error);
  } catch (e) {
    await chrome.storage.session.set({ device: { error: describe(e), reason: "failed" } });
    throw e;
  }
  const device = {
    deviceCode: r.device_code, userCode: r.user_code, uri: r.verification_uri,
    interval: r.interval || 5, expiresIn: r.expires_in, expiresAt: Date.now() + r.expires_in * 1000, error: "",
  };
  await chrome.storage.session.set({ device });
  pollDevice();
  return { userCode: device.userCode, uri: device.uri };
}

// describe keeps the error's type when it says something: "TypeError: Failed to fetch".
function describe(e) {
  return e instanceof TypeError ? String(e) : e.message;
}

let polling = false;

async function pollDevice() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const { device } = await chrome.storage.session.get("device");
      if (!device || device.error) return;
      if (Date.now() > device.expiresAt) {
        await chrome.storage.session.set({ device: { ...device, error: "The code expired.", reason: "expired" } });
        return;
      }
      await new Promise((r) => setTimeout(r, device.interval * 1000));
      const r = await form(ACCESS_TOKEN, {
        client_id: self.HELLOGITTY_CONFIG.OAUTH_CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (r.access_token) {
        await chrome.storage.session.remove("device");
        await signIn(r.access_token, "device", r);
        return;
      }
      if (r.error === "authorization_pending") continue;
      if (r.error === "slow_down") {
        await chrome.storage.session.set({ device: { ...device, interval: r.interval || device.interval + 5 } });
        continue;
      }
      const reason = r.error === "access_denied" ? "denied" : r.error === "expired_token" ? "expired" : "failed";
      await chrome.storage.session.set({ device: { ...device, error: r.error_description || r.error || "Sign-in failed.", reason } });
      return;
    }
  } catch (e) {
    const { device } = await chrome.storage.session.get("device");
    if (device) await chrome.storage.session.set({ device: { ...device, error: describe(e), reason: "failed" } });
  } finally {
    polling = false;
  }
}

// --- events ------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  schedule();
  refresh();
});

chrome.runtime.onStartup.addListener(() => {
  schedule();
  refresh();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) refresh();
});

// A device sign-in outlives a service worker restart: pick the polling back up.
chrome.storage.session.get("device").then(({ device }) => {
  if (device && !device.error) pollDevice();
});

const handlers = {
  refresh: () => refresh(),
  token: (m) => signIn(m.token, "token"),
  signout: () => signOut(),
  webSignIn: () => webSignIn(),
  deviceStart: () => deviceStart(),
  deviceCancel: () => chrome.storage.session.remove("device"),
  settings: async (m) => {
    const maintain = (m.maintain || []).map((s) => s.trim()).filter(Boolean);
    await chrome.storage.local.set({ settings: { maintain } });
    return refresh();
  },
};

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (sender.id !== chrome.runtime.id || !handlers[m && m.type]) return false;
  Promise.resolve()
    .then(() => handlers[m.type](m))
    .then((result) => send({ ok: true, result }), (e) => send({ ok: false, error: e.message, auth: e instanceof AuthError }));
  return true;
});
