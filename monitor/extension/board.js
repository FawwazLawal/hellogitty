// HelloGitty for Chrome: the popup, the side panel and the full view. Each renders the markup of
// the dashboard's page (web/index.html) from the board the service worker keeps in storage, then
// loads the dashboard's own script (dashboard.js, lifted from that page by build.sh) for the theme
// switch, change markers and filters. Like the dashboard, the page reloads to show new data.
//
//   board.html?view=popup   the popup                narrow
//   board.html?view=panel   Chrome's side panel      narrow
//   board.html?view=tab     the full view in a tab   opens the dashboard instead when it runs

const view = new URLSearchParams(location.search).get("view") || "panel";
const narrow = view !== "tab";
// "view-" keeps the names clear of dashboard classes: a body with class "panel" would be drawn as a card.
document.body.classList.add(narrow ? "narrow" : "full", "view-" + view);

const DASHBOARD = "http://localhost:7340/";
const DASHBOARD_ORIGIN = "http://localhost:7340/*";
const FINISHED_SHOWN = 10;
const GRAPHQL_HOURLY = 5000;
const STALE_AFTER = 2 * 60 * 60 * 1000; // the dashboard's "Data is stale" threshold
const RELOAD_EVERY = 5 * 60 * 1000; // the page reloads on the dashboard's 5-minute rhythm
const COPIED_FOR = 1500; // how long the Copy button says "Copied!"
// How long the full view waits for a dashboard at localhost:7340 before drawing the board itself.
// A local server answers in a few milliseconds; this only has to outlast a slow start.
const DASHBOARD_WAIT = 800;
const send = (type, extra) => chrome.runtime.sendMessage({ type, ...extra });

// --- helpers -----------------------------------------------------------------------------------

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

// ago follows the dashboard's wording: "3 days ago".
function ago(iso) {
  const t = Date.parse(iso);
  if (!t || t < 0) return "—";
  const d = (Date.now() - t) / 1000;
  const unit = (n, u) => `${n} ${u}${n === 1 || u === "min" ? "" : "s"} ago`;
  if (d < 60) return "just now";
  if (d < 3600) return unit(Math.floor(d / 60), "min");
  if (d < 86400) return unit(Math.floor(d / 3600), "hour");
  if (d < 14 * 86400) return unit(Math.floor(d / 86400), "day");
  if (d < 60 * 86400) return unit(Math.floor(d / (7 * 86400)), "week");
  if (d < 365 * 86400) return unit(Math.floor(d / (30 * 86400)), "month");
  return unit(Math.floor(d / (365 * 86400)), "year");
}

// utc formats like the dashboard: "2026-10-20 13:04".
function utc(iso) {
  const t = new Date(iso);
  return isNaN(t) ? "" : t.toISOString().slice(0, 16).replace("T", " ");
}

// Links open only on github.com; anything else in the data renders as plain text.
function safeURL(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
  } catch (e) {
    return null;
  }
}

function svgIcon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", kind === "PR" ? "Pull request" : "Issue");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", kind === "PR" ? "#i-pr" : "#i-issue");
  svg.append(use);
  return svg;
}

// --- dashboard markup --------------------------------------------------------------------------

const MOVE_TAG = { you: "Your move", them: "Waiting on others", done: "Finished" };

// The glossary for hover help comes from the Go build through the stored board; without it no word
// is marked as explainable (hide, don't fake).
let GLOSSARY = {};
// NEW is the unread GitHub notifications by row key, from the service worker: {new, what}.
let NEW = {};
const known = (id) => !!(id && GLOSSARY[id]);

// term marks an element the dashboard's hover help explains: data-term (and tabindex when it
// should take keyboard focus), only for terms the glossary has.
function term(id, focusable, extra) {
  if (!known(id)) return {};
  return { "data-term": id, tabindex: focusable ? "0" : null, "data-extra": extra || null };
}

// termText is a heading word with its dotted underline, as on the dashboard.
function termText(id, text, focusable = true) {
  return known(id) ? el("span", { class: "term", ...term(id, focusable) }, text) : text;
}

// peekTemplate is the dashboard's {{define "peek"}}: the card a row title opens on hover or focus.
function peekTemplate(p) {
  if (!p || !p.lines || !p.lines.length) return null;
  const t = document.createElement("template");
  t.className = "peek";
  t.content.append(el("div", { class: "pk" }, el("b", { class: "pk-h" }, p.head),
    el("dl", null, p.lines.map((l) => [el("dt", null, l.label),
      el("dd", { class: l.level || null }, l.items.flatMap((x, i) => (i ? [el("br"), x] : [x])))]))));
  return t;
}

// item is the dashboard's {{define "item"}}. The dot is attention: green when a GitHub notification
// about the row is unread, amber when it's your move, hollow otherwise. data-new is the unread
// notification's time; the dashboard's script lights the dot, the New chip and the "N new" count
// from it, and turns them off once the row is opened from the board.
function item(r, move) {
  const key = r.repo.toLowerCase() + "-" + r.number;
  const k = r.repo.toLowerCase() + "#" + r.number;
  const fresh = NEW[k];
  const words = [r.title, r.repo, "#" + r.number, r.kind, r.status, r.why, r.personal, r.quoteBy, r.quote, "@" + r.author,
    ...(r.labels || []), ...(r.notes || []).map((n) => n.text)];
  const href = safeURL(r.url);
  const qhref = safeURL(r.quoteURL);
  return el("li", {
    class: "wi", "data-k": k, "data-new": fresh ? String(fresh.new) : "0", "data-v": "w-" + key, "data-val": move + "|" + r.status + "|" + (r.personal || ""),
    "data-kind": r.kind.toLowerCase(), "data-repo": r.repo.toLowerCase(), "data-name": r.repo, "data-move": move,
    "data-personal": !!r.personal, "data-s": words.map((w) => w || "").join(" ").toLowerCase(),
  },
    el("span", { class: "dot " + (move === "you" ? "caution" : ""), "aria-hidden": "true", ...term("dot") }),
    el("div", null,
      href ? el("a", { class: "title", href, target: "_blank", rel: "noopener" }, r.title) : el("span", { class: "title" }, r.title),
      peekTemplate(r.peek),
      el("div", { class: "meta" }, svgIcon(r.kind), el("span", null, r.repo), el("span", { class: "num" }, "#" + r.number),
        r.why ? el("span", null, "· " + r.why) : null,
        el("span", { class: "movetag " + move }, MOVE_TAG[move]),
        (r.labels || []).map((l) => el("span", { class: "label" }, l))),
      el("div", { class: "state" },
        el("span", { class: "newchip", ...term("new", true), hidden: true }, fresh && fresh.what ? "New · " + fresh.what : "New"),
        r.personal ? el("span", { class: "only", ...(known("only-you") ? term("only-you", true) : { title: "Only you can do this" }) }, "Only you") : null,
        el("span", { class: "say" + (r.level ? " " + r.level : "") }, r.status),
        (r.notes || []).map((n) => el("span", { class: "note " + (n.level || ""), ...term(n.term, true) }, n.text))),
      r.quote ? el("blockquote", null, qhref ? el("a", { href: qhref, target: "_blank", rel: "noopener" }, r.quoteBy) : [el("b", null, r.quoteBy), " "], r.quote) : null),
    el("div", { class: "end" },
      el("time", { class: "when", title: "Since " + utc(r.since) + "Z" }, ago(r.since)),
      el("span", { class: "trail", ...(known("pill") ? term("pill", false, r.repo + " #" + r.number) : { title: r.repo + " #" + r.number }) },
        el("span", { class: "rp" }, r.repo), el("span", { class: "num" }, "#" + r.number))));
}

function group(title, termId, key, rows, move, none, hot) {
  return el("div", { class: "group mv" },
    el("h3", null, termText(termId, title), " ", el("span", { class: "n" + (hot && rows.length ? " hot" : ""), "data-v": key }, String(rows.length))),
    rows.length ? el("ul", { class: "items" }, rows.map((r) => item(r, move))) : el("p", { class: "none" }, none));
}

// counter is one alert cell, following the dashboard's counter(): the wide cell names three items,
// a narrow one names one, and "+N" counts the rest.
function counter(key, label, names, level, wide, lead) {
  const limit = wide ? 3 : 1;
  const lit = names.length > 0;
  const detail = (lead || "") + names.join(", ");
  const help = known("cell-" + key) ? { tabindex: "0", ...term("cell-" + key, true, detail || null) } : { title: detail || null };
  return el("div", { class: `cell ${level}${lit ? " lit" : ""}${wide ? " wide" : ""}`, ...help },
    el("div", { class: "head" }, el("span", { class: "leg" }, label), el("span", { class: "cnt", "data-v": "cw-" + key }, String(names.length))),
    lit ? el("div", { class: "detrow" }, el("span", { class: "det" }, names.slice(0, limit).join(", ")),
      names.length > limit ? el("span", { class: "more" }, "+" + (names.length - limit)) : null) : null,
    el("span", { class: "sr" }, lit ? "lit" : "not lit"));
}

// valueCell is a dashboard cell that shows a value instead of a count: lit, it names the value.
function valueCell(key, label, value, level, lit, detail) {
  const help = known("cell-" + key) ? { tabindex: "0", ...term("cell-" + key, true, detail || null) } : { title: detail || null };
  return el("div", { class: `cell ${level}${lit ? " lit" : ""}`, ...help },
    el("div", { class: "head" }, el("span", { class: "leg" }, label), value ? el("span", { class: "cnt", "data-v": "cw-" + key }, value) : null),
    el("span", { class: "sr" }, lit ? "lit" : "not lit"));
}

function emptyCell(key, label, value, level, wide) {
  return el("div", { class: `cell ${level}${wide ? " wide" : ""} empty` },
    el("div", { class: "head" }, el("span", { class: "leg" }, label)),
    el("span", { class: "det", "data-v": "cw-" + key }, value),
    el("span", { class: "sr" }, "not lit"));
}

// header is the dashboard's status line, now a CSS-grid 3-column layout matching the dashboard's
// site-header template. The sign-in screens keep only the brand and the theme switch.
function header(st, signingIn) {
  const fetched = st.board ? st.board.fetchedAt : "";
  const since = fetched ? Math.floor(Date.parse(fetched) / 1000) : 0;
  const brand = el("div", { class: "brand" }, el("h1", null, "HelloGitty"),
    el("span", { class: "lbl ver" }, signingIn ? "for Chrome" : "for Chrome " + chrome.runtime.getManifest().version));
  // Center column: telemetry when signed in and not in the sign-in flow.
  const telemetryItems = [];
  if (!signingIn) {
    telemetryItems.push(el("span", { class: "item" }, el("span", { class: "lbl" }, "Last check"),
      since ? el("span", { class: "v", id: "pollage", "data-since": since, title: utc(fetched) + " UTC" }, utc(fetched) + " UTC")
        : el("span", { class: "v zero" }, "not yet")));
    if (!narrow && st.board && st.board.remaining) {
      const used = Math.max(0, GRAPHQL_HOURLY - st.board.remaining);
      const pct = Math.min(100, Math.round((used * 100) / GRAPHQL_HOURLY));
      telemetryItems.push(el("span", { class: "item" }, el("span", { class: "lbl" }, "GitHub GraphQL"),
        el("span", { class: "v" }, el("span", { class: "fig" }, String(used)), " of ", el("span", { class: "fig" }, String(GRAPHQL_HOURLY)), " this hour"),
        el("span", { class: "gauge" + (pct >= 90 ? " hot" : ""), role: "img", "aria-label": pct + " percent of the hourly points used" }, el("i", { style: `width:${pct}%` }))));
    }
  }
  const center = telemetryItems.length ? el("div", { class: "telemetry" }, telemetryItems) : el("div", { class: "telemetry" });
  // Right column: action buttons + theme switch, wrapped in .head-right like the dashboard.
  const rightKids = [];
  if (st.signedIn && !signingIn) {
    rightKids.push(el("button", { type: "button", class: "headbtn", id: "act-refresh" }, "Refresh"));
    if (view === "popup" && chrome.sidePanel) rightKids.push(el("button", { type: "button", class: "headbtn", id: "act-panel" }, "Side panel"));
    if (narrow) rightKids.push(el("button", { type: "button", class: "headbtn", id: "act-full" }, "Full view"));
  }
  rightKids.push(el("div", { class: "theme", role: "group", "aria-label": "Colour theme" },
    ["auto", "light", "dark"].map((t) => {
      const name = t[0].toUpperCase() + t.slice(1);
      return el("button", { type: "button", "data-theme-set": t, "aria-label": name + " theme" }, name);
    })));
  const headRight = el("div", { class: "head-right" }, rightKids);
  return el("header", { class: "status" }, brand, center, headRight);
}

function cells(st) {
  const b = st.board;
  const move = b ? b.you.map((r) => r.repo.split("/").slice(1).join("/") + "#" + r.number) : [];
  const moveCell = b ? counter("your-move", "Your move", move, "caution", true, known("cell-your-move") ? "" : "Pull requests and issues waiting on you. ")
    : emptyCell("your-move", "Your move", "not checked yet", "caution", true);
  // The dashboard's cells that need only the board. Watched issues, repository health and the
  // pipeline come from the dashboard's own server, so they stay there.
  const fetched = b ? Date.parse(b.fetchedAt) : NaN;
  const stale = !b || !(Date.now() - fetched <= STALE_AFTER);
  const staleValue = !b ? "no check yet" : stale ? ago(b.fetchedAt) : "";
  const low = !!(b && b.remaining && b.remaining * 10 < GRAPHQL_HOURLY);
  const unresolvedCell = b ? counter("unresolved", "Unresolved threads", b.unresolvedPRs || [], "caution", false)
    : emptyCell("unresolved", "Unresolved threads", "not checked yet", "caution", false);
  return el("section", { class: "cw", "aria-label": "Alerts" }, moveCell, unresolvedCell,
    counter("poll-fail", "Check failed", st.error ? ["your work"] : [], "warn", false),
    valueCell("data-stale", "Data is stale", staleValue, "warn", stale, "Lit when the last check of GitHub is more than 2 hours old."),
    valueCell("api-low", "API running low", low ? b.remaining + " left" : "", "caution", low, "Lit when under 10% of the hourly GitHub quota remains."));
}

function workPanels(st) {
  const b = st.board;
  const login = st.auth.login || "you";
  const work = el("section", { class: "panel", "aria-labelledby": "work-h", "data-board": true },
    el("h2", { id: "work-h" }, "Your work ", el("span", { class: "lbl" },
      b ? `Pull requests and issues @${login} has out, anywhere on GitHub · updated ${ago(b.fetchedAt)}` : "Not fetched yet"),
      el("span", { class: "nb", id: "newcount", hidden: true })));
  if (!b) {
    work.append(el("p", { class: "pad zero" }, st.error
      ? ["Couldn't load your pull requests and issues: ", el("span", { class: "err" }, st.error)]
      : "Loading your pull requests and issues. This takes a few seconds after you sign in; the page updates on its own."));
    return [work];
  }
  work.append(el("div", { class: "wsort", role: "group", "aria-label": "Sort work items" },
    el("button", { type: "button", "data-wsort": "name" }, "Name"),
    el("button", { type: "button", "data-wsort": "updated", title: "Sort by last update" }, "Updated")));
  const own = (rows) => rows.filter((r) => !r.incoming);
  const theirs = (rows) => rows.filter((r) => r.incoming);
  const done = b.done.slice(0, FINISHED_SHOWN);
  const more = b.done.length - done.length;
  work.append(
    group("Your move", "group-you", "work-you", own(b.you), "you", "Nothing is waiting on you.", true),
    group("Waiting on others", "group-them", "work-them", own(b.them), "them", "Nothing out for review or waiting on a reply.", false),
    el("details", { class: "group mv", "data-key": "work-done" },
      el("summary", null, termText("group-done", "Finished", false), " in the last 30 days ", el("span", { class: "n", "data-v": "work-done" }, done.length + (more > 0 ? "+" : "")), el("span", { class: "chev", "aria-hidden": "true" })),
      done.length ? el("ul", { class: "items" }, done.map((r) => item(r, "done"))) : el("p", { class: "none" }, "Nothing merged or closed in the last 30 days."),
      more > 0 ? el("p", { class: "hint" }, more + " more not shown.") : null),
    st.error ? el("p", { class: "pad err" }, "The last refresh failed, so this is the previous list: " + st.error) : null);
  const repos = el("section", { class: "panel", "aria-labelledby": "repos-h", "data-board": true },
    el("h2", { id: "repos-h" }, "Your repositories ", el("span", { class: "lbl" }, "Open pull requests and issues from others in " + b.scope)),
    group("Needs you", "group-inyou", "work-inyou", theirs(b.you), "you", "No reviews requested and no unanswered issues.", true),
    group("Waiting on contributors", "group-inthem", "work-inthem", theirs(b.them), "them", "Nothing waiting on a contributor.", false),
    el("p", { class: "hint" }, "Maintain repositories you don't own? Add them under Also maintain, below."));
  return [work, repos];
}

function checksPanel(st) {
  const b = st.board;
  return el("section", { class: "panel", "aria-labelledby": "poll-h" }, el("h2", { id: "poll-h" }, "Checks"),
    el("dl", { class: "kv" },
      el("dt", null, "Last check finished"), el("dd", null, b ? utc(b.fetchedAt) + " UTC" : el("span", { class: "zero" }, "not yet")),
      el("dt", null, "Next check"), el("dd", null, st.next ? utc(new Date(st.next).toISOString()) + " UTC" : el("span", { class: "zero" }, "starting")),
      el("dt", null, "Checks run every"), el("dd", null, "5 min"),
      el("dt", null, "New activity"), el("dd", null, !st.notify ? el("span", { class: "zero" }, "not checked yet")
        : st.notify.state === "ok" ? "from GitHub notifications" : el("span", { class: "zero" }, "off")),
      el("dt", null, termText("graphql", "Your work refresh")), el("dd", null, b && b.cost
        ? [el("span", { class: "fig" }, String(b.cost)), " GraphQL points · ", el("span", { class: "fig" }, String(b.remaining)), " left"]
        : el("span", { class: "zero" }, "—"))),
    st.notify && st.notify.state === "off" ? el("p", { class: "pad lbl" }, st.notify.note) : null);
}

function accountPanel(st) {
  const a = st.auth;
  return el("section", { class: "panel", "aria-labelledby": "acct-h" },
    el("h2", { id: "acct-h" }, "Account ", el("span", { class: "lbl" }, a.login ? "@" + a.login : "")),
    el("dl", { class: "kv" },
      el("dt", null, "Signed in"), el("dd", null, a.via === "device" ? "with GitHub" : "with a token"),
      el("dt", null, "Counted as yours"), el("dd", null, st.board ? st.board.scope : el("span", { class: "zero" }, "—"))),
    el("form", { class: "pad form", id: "settings-form" },
      el("label", { for: "maintain", class: "lbl" }, "Also maintain"),
      el("input", { type: "text", id: "maintain", spellcheck: "false", placeholder: "owner/name, org", value: (st.maintain || []).join(", ") }),
      el("p", { class: "lbl" }, "Repositories or organisations whose incoming pull requests and issues count as yours. Repositories your account owns always count."),
      el("button", { type: "submit", class: "btn" }, "Save")),
    el("p", { class: "pad" }, el("button", { type: "button", class: "clear", id: "signout" }, "Sign out")));
}

function dashboardPanel() {
  return el("section", { class: "panel", "aria-labelledby": "dash-h" }, el("h2", { id: "dash-h" }, "HelloGitty on this computer"),
    el("p", { class: "pad" }, "If HelloGitty runs on this computer, the full view opens its dashboard instead. It adds your tracked repositories, the pipeline and the watch list."),
    el("p", { class: "pad" }, el("button", { type: "button", class: "btn", id: "use-dashboard" }, "Use the HelloGitty dashboard")),
    el("p", { class: "pad err", id: "dash-err", hidden: true }));
}

// --- sign-in -----------------------------------------------------------------------------------
//
// The sign-in card follows the HelloGitty for Chrome Figma file (page "Redesign · matches
// dashboard"). Every state comes from real data: the device sign-in the service worker keeps in
// chrome.storage.session (its code, lifetime and failure reason), the "signin.expired" flag it sets
// when GitHub stops accepting a sign-in, and what happened on this page: the token form opened, a
// token GitHub refused, or Chrome's github.com/login prompt declined. Those last three live in
// sessionStorage so the page's reloads keep them.

const LOGIN_ORIGIN = "https://github.com/login/*";
const DEVICE_PAGE = "https://github.com/login/device";
const TOKEN_PAGE = "https://github.com/settings/personal-access-tokens/new";
// Octicons mark-github-16 (MIT), from @primer/octicons 19.41.0.
const MARK = "M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656";

// ui reads this page's sign-in state, or merges a change into it (null clears it).
function ui(patch) {
  let cur = {};
  try { cur = JSON.parse(sessionStorage.getItem("hellogitty-signin") || "{}") || {}; } catch (e) {}
  if (patch === undefined) return cur;
  cur = patch === null ? {} : { ...cur, ...patch };
  try { sessionStorage.setItem("hellogitty-signin", JSON.stringify(cur)); } catch (e) {}
  return cur;
}

function mark() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", class: "mark" })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", MARK);
  svg.append(path);
  return svg;
}

const primary = (id, text, withMark, type) => el("button", { type: type || "button", class: "btn primary block", id }, withMark ? mark() : null, text);
const quiet = (id, text) => el("button", { type: "button", class: "quiet", id }, text);
const divider = () => el("hr", { class: "sg-rule" });
const tokenLink = () => el("div", { class: "sg-links" }, quiet("sg-token-open", "Use a personal access token instead"));
const statusRow = (dot, text) => el("p", { class: "sg-status " + dot }, el("span", { class: "sg-dot", "aria-hidden": "true" }), el("span", null, text));
// note is a status line and the sentence that explains it.
const note = (dot, text, detail) => [statusRow(dot, text), el("p", { class: "sg-dim" }, detail)];
// spinner is the "waiting" line with its ring.
const spinner = (text) => el("span", { class: "sg-waiting" }, el("span", { class: "sg-ring", "aria-hidden": "true" }), text);
// startCard is the shape most sign-in states share: what happened, the button that (re)starts
// Sign in with GitHub, anything under it, and with token, the way to a personal access token.
function startCard(lead, label, { after = [], token = false } = {}) {
  return [...lead, primary("sg-start", label, true), ...after, ...(token ? [divider(), tokenLink()] : [])];
}

// minutes is how long GitHub said the code lasts; without that number the sentence is left out.
function minutes(device) {
  return device && device.expiresIn ? Math.round(device.expiresIn / 60) : 0;
}

function startBlock() {
  return startCard([], "Sign in with GitHub", { token: true, after: [
    el("ul", { class: "sg-points" }, ["Read-only: HelloGitty never writes to GitHub", "Your sign-in stays in this browser",
      "Checks every 5 minutes and talks only to GitHub"].map((t) => el("li", null, t)))] });
}

function allowBlock() {
  return startCard([el("p", null, "To sign in, HelloGitty needs to reach github.com/login. Chrome asks you to allow that once.")],
    "Allow and sign in", { token: true });
}

function waitingBlock(d) {
  const n = minutes(d);
  return [el("h3", { class: "sg-h" }, "Approve on GitHub"),
    el("p", null, "GitHub is open in a new tab. Paste this code there (it's already copied) and approve HelloGitty."),
    el("div", { class: "sg-code" }, el("span", { class: "sg-code-text", id: "sg-user-code" }, d.userCode), el("button", { type: "button", class: "btn", id: "sg-copy" }, "Copy")),
    el("button", { type: "button", class: "btn block", id: "sg-open" }, "Open github.com/login/device"),
    el("div", { class: "sg-wait" }, spinner("Waiting for you to approve it…"), quiet("sg-cancel", "Cancel")),
    n ? el("p", { class: "sg-small" }, `The code works for ${n} minutes.`) : null];
}

function expiredBlock(d) {
  const n = minutes(d);
  return startCard(note("caution", "The code expired.", n ? `Codes last ${n} minutes. Start again for a new one.` : "Start again for a new one."),
    "Start again");
}

function deniedBlock() {
  return startCard(note("caution", "Sign-in was cancelled on GitHub.", "Nothing was shared with HelloGitty. Start again whenever you're ready."),
    "Try again");
}

function failedBlock(d) {
  return startCard([el("p", { class: "sg-fail" }, "Couldn't reach GitHub to start sign-in."), el("pre", { class: "sg-errbox" }, d.error)],
    "Try again", { token: true });
}

function tokenBlock(error, clientID) {
  return [el("form", { class: "sg-form", id: "sg-token-form" },
    el("label", { class: "sg-label", for: "sg-token" }, "Personal access token"),
    el("input", { type: "password", id: "sg-token", class: "sg-field" + (error ? " bad" : ""), autocomplete: "new-password", spellcheck: "false",
      placeholder: "github_pat_…", "aria-invalid": error ? "true" : null, "aria-describedby": error ? "sg-token-err" : null }),
    error ? el("p", { class: "sg-bad", id: "sg-token-err" }, error) : null,
    el("p", { class: "sg-help" }, "A fine-grained token with no extra permissions covers public repositories. Add private ones if you want them on your board."),
    primary("sg-token-submit", "Sign in", false, "submit")),
  el("div", { class: "sg-links" },
    el("a", { class: "quiet", href: TOKEN_PAGE, target: "_blank", rel: "noopener" }, "Create a fine-grained token"),
    clientID ? quiet("sg-token-back", "Back to Sign in with GitHub") : null)];
}

function signingBlock() {
  return [el("div", { class: "sg-wait" }, spinner("Opening GitHub…"))];
}

function webErrorBlock(error) {
  return startCard(note("caution", "Sign-in didn't complete.", error), "Try again", { token: true });
}

function signedInBlock(login) {
  return note("nom", login ? "Signed in as @" + login : "Signed in",
    "Loading your pull requests and issues. Your board appears here in a few seconds.");
}

// signInColumn is the notice, the card and the line under it, for the current state.
function signInColumn(st) {
  const u = ui();
  const clientID = self.HELLOGITTY_CONFIG && self.HELLOGITTY_CONFIG.OAUTH_CLIENT_ID;
  const d = st.device;
  let block;
  if (st.signedIn) block = signedInBlock(st.auth.login);
  else if (u.mode === "token" || !clientID) block = tokenBlock(u.tokenError, clientID);
  else if (u.mode === "signing") block = signingBlock();
  else if (u.mode === "webError") block = webErrorBlock(u.webError);
  else if (d && !d.error && d.userCode) block = waitingBlock(d);
  else if (d && d.reason === "expired") block = expiredBlock(d);
  else if (d && d.reason === "denied") block = deniedBlock();
  else if (d && d.error) block = failedBlock(d);
  else if (u.mode === "allow") block = allowBlock();
  else block = startBlock();
  return el("div", { class: "sg-col" },
    st.expired && !st.signedIn ? el("p", { class: "sg-notice", role: "status" }, "Your GitHub sign-in expired. Sign in again to keep your board current.") : null,
    el("section", { class: "sg-card", "aria-labelledby": "sg-title" },
      el("div", { class: "sg-mascot", "aria-hidden": "true" }, el("img", { src: "mascot/rest.png", alt: "" })),
      el("div", { class: "sg-body" },
        el("h2", { class: "sg-title", id: "sg-title" }, st.signedIn ? "You're signed in" : "Your GitHub work, sorted by whose move it is"),
        st.signedIn ? null : el("p", { class: "sg-lede" }, "See every pull request and issue you have out and what's waiting on you."),
        block)),
    el("p", { class: "sg-foot" }, "Read-only · your sign-in stays in this browser · talks only to GitHub"));
}

// redraw swaps in the card for a change made on this page; storage changes reload the page instead.
// What was typed in the token field carries over, in memory only.
async function redraw() {
  const col = document.querySelector(".sg-col");
  const typed = document.getElementById("sg-token");
  const value = typed ? typed.value : "";
  if (col) col.replaceWith(signInColumn(await state()));
  const field = document.getElementById("sg-token");
  if (field) {
    field.value = value;
    field.focus();
  }
}

// startSignIn uses the one-click web auth flow when the exchange server is configured. Otherwise
// it falls back to the device flow (copy-paste a code). A declined Chrome prompt shows the
// "Allow and sign in" state.
async function startSignIn() {
  const exchangeURL = self.HELLOGITTY_CONFIG && self.HELLOGITTY_CONFIG.OAUTH_EXCHANGE_URL;
  if (exchangeURL) {
    ui({ mode: "signing" });
    redraw();
    const res = await send("webSignIn");
    if (res && res.ok) { ui(null); return; }
    const why = (res && res.error) || "Sign-in failed";
    ui({ mode: "webError", webError: why });
    redraw();
    return;
  }
  const granted = await chrome.permissions.request({ origins: [LOGIN_ORIGIN] });
  if (!granted) {
    ui({ mode: "allow" });
    await send("deviceCancel");
    redraw();
    return;
  }
  ui(null);
  const res = await send("deviceStart");
  if (!res || !res.ok) return;
  await navigator.clipboard.writeText(res.result.userCode).catch(() => {});
  chrome.tabs.create({ url: safeURL(res.result.uri) || DEVICE_PAGE });
}

async function submitToken() {
  const value = document.getElementById("sg-token").value.trim();
  if (!value) {
    ui({ mode: "token", tokenError: "Paste a token first." });
    return redraw();
  }
  const res = await send("token", { token: value });
  if (res && res.ok) {
    ui(null);
    return;
  }
  const why = ((res && res.error) || "Sign-in failed").replace(/\.$/, "");
  ui({ mode: "token", tokenError: res && res.auth ? `That token didn't work. GitHub said: ${why}.` : `Couldn't check the token: ${why}.` });
  redraw();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  switch (t.id) {
    case "sg-start": startSignIn(); break;
    case "sg-token-open": ui({ mode: "token", tokenError: "" }); redraw(); break;
    case "sg-token-back": ui(null); send("deviceCancel"); redraw(); break;
    case "sg-copy":
      navigator.clipboard.writeText(document.getElementById("sg-user-code").textContent)
        .then(() => { t.textContent = "Copied!"; setTimeout(() => { t.textContent = "Copy"; }, COPIED_FOR); })
        .catch(() => {});
      break;
    case "sg-open": state().then((st) => chrome.tabs.create({ url: (st.device && safeURL(st.device.uri)) || DEVICE_PAGE })); break;
    case "sg-cancel": send("deviceCancel"); break;
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "sg-token-form") return;
  e.preventDefault();
  submitToken();
});

// --- page --------------------------------------------------------------------------------------

async function state() {
  const { auth, board, status, settings, signin, notify } = await chrome.storage.local.get(["auth", "board", "status", "settings", "signin", "notify"]);
  const { device } = await chrome.storage.session.get("device").catch(() => ({}));
  const alarm = await chrome.alarms.get("refresh").catch(() => null);
  return {
    auth: auth || {}, signedIn: !!(auth && auth.token), board, error: (status && status.error) || "",
    maintain: settings && settings.maintain, device, notify, next: alarm && alarm.scheduledTime, expired: !!(signin && signin.expired),
  };
}

async function render() {
  const st = await state();
  GLOSSARY = (st.board && st.board.glossary) || {};
  NEW = (st.notify && st.notify.state === "ok" && st.notify.rows) || {};
  // Signed out, or signed in with the first board still on its way: the sign-in card.
  const signingIn = !st.signedIn || (!st.board && !st.error);
  document.body.classList.toggle("signing-in", signingIn);
  const body = [header(st, signingIn)];
  if (signingIn) {
    body.push(el("div", { class: "grid sg-grid" }, el("div", { class: "main" }, signInColumn(st)),
      narrow ? null : el("div", { class: "rail" }, dashboardPanel())));
  } else {
    body.push(cells(st));
    body.push(el("div", { class: "grid" },
      el("div", { class: "main" }, workPanels(st)),
      el("div", { class: "rail" }, checksPanel(st), accountPanel(st), narrow ? null : dashboardPanel())));
  }
  if (!signingIn) body.push(el("footer", null, "Checks your work every 5 minutes · talks only to GitHub · runs only in this browser"));
  const glossary = el("script", { type: "application/json", id: "glossary" });
  glossary.textContent = JSON.stringify(GLOSSARY);
  document.body.append(glossary, ...body);
  wire();
  // The dashboard's own script, run on the markup above, as the dashboard page runs it.
  document.body.append(el("script", { src: "dashboard.js" }));
}

// Reload when the board, sign-in or settings change, and every 5 minutes as the dashboard does,
// but never under someone's typing: wait until the field loses focus.
let reloadWaiting = false;
function reload() {
  const a = document.activeElement;
  if (a && (a.tagName === "INPUT" || a.tagName === "SELECT") && a.type !== "checkbox") {
    reloadWaiting = true;
    return;
  }
  location.reload();
}
document.addEventListener("focusout", () => { if (reloadWaiting) setTimeout(reload, 0); });
chrome.storage.onChanged.addListener(() => reload());
// A hidden page (a background tab, a closed side panel) skips the timed reload and catches up
// when it is shown again.
let reloadMissed = false;
setInterval(() => { if (document.hidden) reloadMissed = true; else reload(); }, RELOAD_EVERY);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && reloadMissed) { reloadMissed = false; reload(); }
});

// The popup keeps Tab inside it: past the last control, focus goes back to the first.
if (view === "popup") {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const list = [...document.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === document.body)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  });
}

// --- actions -----------------------------------------------------------------------------------

function on(id, event, fn) {
  const e = document.getElementById(id);
  if (e) e.addEventListener(event, fn);
}

function showErr(id, text) {
  const e = document.getElementById(id);
  if (e) { e.textContent = text; e.hidden = !text; }
}

// sidePanel.open has to run inside the click, before any await, so the window is looked up first.
let windowId;
chrome.windows.getCurrent().then((w) => { windowId = w.id; }).catch(() => {}); // without it, Side panel does nothing

function wire() {
  on("act-refresh", "click", (e) => { e.target.textContent = "Refreshing…"; send("refresh").finally(() => { e.target.textContent = "Refresh"; }); });
  on("act-panel", "click", () => { if (windowId !== undefined) chrome.sidePanel.open({ windowId }).then(() => window.close()); });
  on("act-full", "click", () => { chrome.tabs.create({ url: chrome.runtime.getURL("board.html?view=tab") }); if (view === "popup") window.close(); });
  on("use-dashboard", "click", async () => {
    showErr("dash-err", "");
    if (!(await chrome.permissions.request({ origins: [DASHBOARD_ORIGIN] }))) {
      showErr("dash-err", "HelloGitty for Chrome needs to reach localhost:7340 to find the dashboard.");
      return;
    }
    if (!(await openDashboard())) showErr("dash-err", "HelloGitty isn't answering at localhost:7340. Start it with ./start.sh, then try again.");
  });
  on("settings-form", "submit", (e) => {
    e.preventDefault();
    const field = document.getElementById("maintain");
    field.blur();
    send("settings", { maintain: field.value.split(",") });
  });
  on("signout", "click", () => send("signout"));
}

// openDashboard sends the full view to the dashboard when it answers at localhost:7340.
async function openDashboard() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DASHBOARD_WAIT);
  try {
    const res = await fetch(DASHBOARD, { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return false;
    location.replace(DASHBOARD);
    return true;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  if (view === "tab" && (await chrome.permissions.contains({ origins: [DASHBOARD_ORIGIN] })) && (await openDashboard())) return;
  render();
})();
