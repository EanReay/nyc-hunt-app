(function () {
"use strict";

const CFG = window.HUNT_CONFIG || {};
const BUILTIN = window.CATEGORIES || [];
// The current hunt's categories and challenges. Rebuilt by applyHunt() whenever data loads.
let CATS = [], ITEMS = [], BY_ID = {};
const BUCKET = "hunt";
const MAX_BYTES = 50 * 1024 * 1024;

// ---------- small helpers ----------
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmt = n => (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("en-US");
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let toastT;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200); }
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function show(id) { ["#screen-config", "#screen-error", "#screen-code", "#screen-join", "#screen-admin", "#app"].forEach(s => { $(s).hidden = s !== id; }); }

// ---------- config check ----------
if (!CFG.SUPABASE_URL || /YOUR-PROJECT/.test(CFG.SUPABASE_URL) || !CFG.SUPABASE_KEY || /PASTE-YOUR/.test(CFG.SUPABASE_KEY) || !window.supabase) {
  show("#screen-config");
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: false } });

// ---------- state ----------
const S = {
  code: lsGet("hunt-code", null), hunt: null, custom: [],
  teams: { A: "Team A", B: "Team B" },
  subs: [], counters: {}, awards: {}, endsAt: null,
  me: lsGet("hunt-me", null),
  judge: lsGet("hunt-judge", false),
  tab: "list", cat: lsGet("hunt-cat", "all"), feedFilter: "all",
  openSheet: null,
  adminTab: "hunts", editHunt: null, adminHunts: []
};
const nm = t => S.teams[t] || ("Team " + t);
const other = t => (t === "A" ? "B" : "A");
const mediaUrl = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// ---------- challenge catalog ----------
// Every challenge: the built-in ones from challenges.js plus the ones made on the Admin page.
function catalog() {
  const cats = BUILTIN.map(c => ({ id: c.id, name: c.name, note: c.note, items: c.items.map(i => Object.assign({ cat: c.id }, i)) }));
  const byCat = Object.fromEntries(cats.map(c => [c.id, c]));
  S.custom.forEach(r => {
    let c = byCat[r.cat_id];
    if (!c) { c = byCat[r.cat_id] = { id: r.cat_id, name: r.cat_name, note: "", items: [] }; cats.push(c); }
    c.items.push({ id: r.id, cat: c.id, text: r.text, note: r.note || "", points: r.points, type: r.type, judgeOnly: r.judge_only, custom: true });
  });
  return cats;
}
function applyHunt() {
  const pick = S.hunt && S.hunt.challenge_ids ? new Set(S.hunt.challenge_ids) : null;
  CATS = catalog().map(c => Object.assign({}, c, { items: pick ? c.items.filter(i => pick.has(i.id)) : c.items })).filter(c => c.items.length);
  ITEMS = CATS.flatMap(c => c.items);
  BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
}

// ---------- data ----------
async function q(p) { const r = await p; if (r.error) throw r.error; return r.data; }
async function loadAll() {
  const [hunts, custom, subs, counters, awards] = await Promise.all([
    q(sb.from("hunts").select("*").eq("code", S.code)),
    q(sb.from("challenges").select("*").order("created_at")),
    q(sb.from("submissions").select("*").eq("hunt", S.code).order("created_at", { ascending: false })),
    q(sb.from("counters").select("*").eq("hunt", S.code)),
    q(sb.from("awards").select("*").eq("hunt", S.code))
  ]);
  S.hunt = (hunts && hunts[0]) || null;
  if (!S.hunt) return false;
  S.teams = { A: S.hunt.team_a, B: S.hunt.team_b };
  S.endsAt = S.hunt.ends_at ? new Date(S.hunt.ends_at) : null;
  S.custom = custom || [];
  applyHunt();
  S.subs = subs || [];
  announceNew();
  S.counters = {};
  (counters || []).forEach(c => { (S.counters[c.challenge_id] = S.counters[c.challenge_id] || {})[c.team] = c.count; });
  S.awards = {};
  (awards || []).forEach(a => { if (a.team) S.awards[a.challenge_id] = a.team; });
  return true;
}
// Banner when the other team completes (or enters) a challenge. The first load only records what's already there.
let seenSubs = null;
function announceNew() {
  const fresh = seenSubs ? S.subs.filter(s => !seenSubs.has(s.id)) : [];
  seenSubs = new Set(S.subs.map(s => s.id));
  if (!S.me || S.tab !== "list") return;
  fresh.reverse().forEach(s => {
    const it = BY_ID[s.challenge_id];
    if (!it || s.rejected || s.team === S.me.team) return;
    if (it.type === "once" && subsFor(it.id, s.team).length === 1) showBanner(s.team, `${nm(s.team)} completed “${it.text}” (+${fmt(it.points)})`);
    else if (it.type === "judge") showBanner(s.team, `${nm(s.team)} entered “${it.text}”`);
  });
}
function showBanner(team, msg) {
  const root = $("#banners");
  const b = h("div", { class: "banner " + team.toLowerCase(), role: "status", onclick: () => b.remove() }, msg);
  root.append(b);
  setTimeout(() => { b.classList.add("fade"); setTimeout(() => b.remove(), 600); }, 10000);
}

let reloadT, reloading = false, reloadAgain = false;
function scheduleReload(delay) {
  clearTimeout(reloadT);
  reloadT = setTimeout(async () => {
    if (reloading) { reloadAgain = true; return; }
    reloading = true;
    try {
      if (S.code && !$("#app").hidden) {
        if (await loadAll()) renderAll();
        else showCode("That hunt was deleted. Enter another code.");
      }
    } catch (e) { console.warn(e); }
    reloading = false;
    if (reloadAgain) { reloadAgain = false; scheduleReload(50); }
  }, delay == null ? 250 : delay);
}
function subscribe() {
  const ch = sb.channel("hunt-live");
  ["hunts", "challenges", "submissions", "counters", "awards"].forEach(t =>
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => scheduleReload()));
  ch.subscribe(status => {
    $("#liveDot").classList.toggle("on", status === "SUBSCRIBED");
    if (status === "SUBSCRIBED") scheduleReload(0);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleReload(0); });
  setInterval(() => { if (!document.hidden) scheduleReload(0); }, 20000);
}

// ---------- scoring ----------
function subsFor(cid, team, includeRejected) { return S.subs.filter(s => s.challenge_id === cid && (!team || s.team === team) && (includeRejected || !s.rejected)); }
function cnt(cid, t) { return (S.counters[cid] && S.counters[cid][t]) || 0; }
function earned(it, t) {
  if (it.type === "once") return subsFor(it.id, t).length ? it.points : 0;
  if (it.type === "judge") return S.awards[it.id] === t ? it.points : 0;
  if (it.type === "count") return cnt(it.id, t) * it.points;
  return 0;
}
function totals(t) {
  let pts = 0, done = 0;
  ITEMS.forEach(it => {
    const e = earned(it, t); pts += e;
    if ((it.type === "once" || it.type === "judge") && e) done++;
  });
  return { pts, done };
}

// ---------- rendering ----------
function renderBoard() {
  ["A", "B"].forEach(t => {
    const tot = totals(t);
    $("#name" + t).textContent = nm(t);
    $("#score" + t).textContent = fmt(tot.pts);
    $("#meta" + t).textContent = tot.done + " done";
    $("#team" + t).classList.toggle("mine", !!S.me && S.me.team === t);
  });
  if (S.me) $("#meText").textContent = S.me.name + " · " + nm(S.me.team) + (S.judge ? " · judge" : "");
  renderClock();
}
function renderClock() {
  const el = $("#clock");
  if (!S.endsAt) { el.textContent = "Clock not started"; el.classList.remove("warn"); return; }
  const ms = S.endsAt - Date.now();
  if (ms <= 0) { el.textContent = "Time's up"; el.classList.add("warn"); return; }
  const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  el.textContent = (hh ? hh + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0") + " left";
  el.classList.toggle("warn", ms < 15 * 60 * 1000);
}
setInterval(() => { if (S.me) renderClock(); }, 1000);

function statusPills(it) {
  const wrap = h("div", { class: "stat" });
  ["A", "B"].forEach(t => {
    let cls = "pill " + t.toLowerCase(), label = t;
    if (it.type === "once") { if (subsFor(it.id, t).length) cls += " on"; }
    else if (it.type === "judge") {
      if (S.awards[it.id] === t) { cls += " on"; label = "★"; }
      else if (subsFor(it.id, t).length) cls += " part";
    } else if (it.type === "count") { const c = cnt(it.id, t); if (c) { cls += " on"; label = "×" + c; } }
    wrap.append(h("span", { class: cls, "aria-label": nm(t) }, label));
  });
  return wrap;
}

function renderList() {
  const root = $("#view-list"); root.textContent = "";
  if (S.cat !== "all" && S.cat !== "open" && !CATS.some(c => c.id === S.cat)) S.cat = "all";
  const chips = h("div", { class: "chips", role: "toolbar" });
  [{ id: "all", name: "All" }, { id: "open", name: "Still open for us" }].concat(CATS).forEach(c => {
    chips.append(h("button", { class: "chip", "aria-pressed": String(S.cat === c.id), onclick: () => { S.cat = c.id; lsSet("hunt-cat", c.id); renderList(); } }, c.name));
  });
  root.append(chips);
  const myT = S.me && S.me.team;
  let shown = 0;
  CATS.forEach(c => {
    if (S.cat !== "all" && S.cat !== "open" && S.cat !== c.id) return;
    let its = c.items.map(i => BY_ID[i.id]);
    if (S.cat === "open") its = its.filter(it => it.type === "once" ? !subsFor(it.id, myT).length : it.type === "judge" ? !S.awards[it.id] && !subsFor(it.id, myT).length : false);
    if (!its.length) return;
    const claimable = c.items.filter(i => i.type !== "count");
    const dA = claimable.filter(i => earned(BY_ID[i.id], "A")).length, dB = claimable.filter(i => earned(BY_ID[i.id], "B")).length;
    const sec = h("section", { class: "cat" },
      h("div", { class: "cathead" }, h("h2", { text: c.name }),
        h("span", { class: "ct" }, claimable.length ? `${nm("A")} ${dA}/${claimable.length} · ${nm("B")} ${dB}/${claimable.length}` : "")),
      c.note ? h("p", { class: "catnote", text: c.note }) : null);
    const ul = h("ul", { class: "items" });
    its.forEach(it => {
      shown++;
      ul.append(h("li", { class: "item", tabindex: "0", role: "button", onclick: () => openSheet(it.id), onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(it.id); } } },
        h("div", { class: "pts" + (it.points < 0 ? " neg" : "") }, fmt(it.points), it.type === "count" ? h("small", { text: "each" }) : null),
        h("div", null,
          h("div", { class: "it" }, it.text, it.type === "judge" ? h("span", { class: "tag", text: "Judge" }) : null),
          it.note ? h("div", { class: "in", text: it.note }) : null),
        statusPills(it)));
    });
    sec.append(ul); root.append(sec);
  });
  if (!shown) root.append(h("p", { class: "empty", text: "Nothing left open here. Nice work." }));
}

function postCard(s, compact) {
  const it = BY_ID[s.challenge_id];
  const media = s.media_path
    ? (String(s.media_type || "").startsWith("video")
      ? h("video", { class: "media", src: mediaUrl(s.media_path), controls: true, playsinline: true, preload: "metadata" })
      : h("img", { class: "media zoomable", src: mediaUrl(s.media_path), loading: "lazy", alt: it ? it.text : "Submission", onclick: e => { e.stopPropagation(); openLightbox(mediaUrl(s.media_path), it ? it.text : ""); } }))
    : null;
  const card = h("article", { class: "post" + (s.rejected ? " rej" : "") },
    media,
    s.rejected ? h("span", { class: "rejtag", text: "Rejected" }) : null,
    h("div", { class: "meta" },
      compact ? null : h("div", { class: "ch" }, it ? it.text : s.challenge_id),
      h("div", { class: "who" }, h("span", { class: "tteam " + s.team.toLowerCase(), text: nm(s.team) }), h("span", { text: s.player || "" }), h("span", { class: "when", text: "· " + ago(s.created_at) })),
      s.caption ? h("div", { class: "cap", text: s.caption }) : null));
  if (S.me && s.team === S.me.team) {
    card.append(h("div", { class: "judgebar" },
      h("button", { class: "btn ghost sm", onclick: e => { e.stopPropagation(); deleteSub(s); } }, "Delete")));
  }
  if (S.judge) {
    card.append(h("div", { class: "judgebar" },
      h("button", { class: "btn ghost sm", onclick: async e => { e.stopPropagation(); await act(() => sb.from("submissions").update({ rejected: !s.rejected }).eq("id", s.id), s.rejected ? "Restored" : "Rejected"); } }, s.rejected ? "Restore" : "Reject"),
      compact ? null : h("button", { class: "btn ghost sm", onclick: () => openSheet(s.challenge_id) }, "Open challenge")));
  }
  return card;
}

async function deleteSub(s) {
  const it = BY_ID[s.challenge_id];
  if (!confirm("Delete this " + (String(s.media_type || "").startsWith("video") ? "video" : "photo") + "?" + (it && it.type === "once" && subsFor(it.id, s.team).length === 1 && !s.rejected ? " " + nm(s.team) + " loses the " + fmt(it.points) + " points for it." : ""))) return;
  const ok = await act(() => sb.from("submissions").delete().eq("id", s.id), "Deleted");
  // Best effort: the row is what counts for scoring. Needs the hunt_delete storage policy from setup.sql.
  if (ok && s.media_path) sb.storage.from(BUCKET).remove([s.media_path]).catch(() => {});
}

// ---------- photo viewer ----------
function openLightbox(src, alt) {
  closeLightbox();
  const box = h("div", { class: "lightbox", id: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": alt || "Photo", onclick: closeLightbox },
    h("img", { src, alt: alt || "Photo" }),
    h("button", { class: "close", "aria-label": "Close", onclick: closeLightbox }, "×"));
  document.body.append(box);
}
function closeLightbox() { const lb = $("#lightbox"); if (lb) lb.remove(); }

function renderFeed() {
  const root = $("#view-feed"); root.textContent = "";
  const seg = h("div", { class: "seg", role: "group", style: "margin-top:12px" });
  [["all", "Everyone"], ["A", nm("A")], ["B", nm("B")]].forEach(([k, label]) =>
    seg.append(h("button", { "aria-pressed": String(S.feedFilter === k), onclick: () => { S.feedFilter = k; renderFeed(); } }, label)));
  root.append(seg);
  const list = S.subs.filter(s => S.feedFilter === "all" || s.team === S.feedFilter);
  const feed = h("div", { class: "feed" });
  if (!list.length) feed.append(h("p", { class: "empty", text: "No photos yet. The first one shows up here the moment it's posted." }));
  list.forEach(s => feed.append(postCard(s, false)));
  root.append(feed);
}

async function act(fn, okMsg) {
  try { const r = await fn(); if (r && r.error) throw r.error; if (okMsg) toast(okMsg); scheduleReload(0); return true; }
  catch (e) { console.warn(e); toast("Didn't save. Check your signal and try again."); return false; }
}
function bump(cid, team, d) { return act(() => sb.rpc("bump", { h: S.code, cid, t: team, d })); }
function award(cid, team) {
  return act(() => team ? sb.from("awards").upsert({ hunt: S.code, challenge_id: cid, team, updated_at: new Date().toISOString() }) : sb.from("awards").delete().eq("hunt", S.code).eq("challenge_id", cid),
    team ? nm(team) + " wins it" : "Award cleared");
}

function renderJudge() {
  const root = $("#view-judge"); root.textContent = "";
  const wrap = h("div", { class: "jwrap" });
  root.append(wrap);
  if (!S.judge) {
    const pin = h("input", { class: "t", type: "password", inputmode: "numeric", id: "judgePin", placeholder: "Judge PIN", autocomplete: "off" });
    const err = h("p", { class: "err", hidden: true, text: "Wrong PIN." });
    const form = h("form", { class: "box", onsubmit: e => {
      e.preventDefault();
      if (pin.value.trim() === String(CFG.JUDGE_PIN)) { S.judge = true; lsSet("hunt-judge", true); renderAll(); toast("Judge mode on"); }
      else err.hidden = false;
    } }, h("h4", { text: "Judge only" }), h("p", { class: "muted", style: "margin:0", text: "Awards the judge's-call items, rejects bad photos, runs the clock and logs penalties." }), pin, err, h("button", { class: "btn" }, "Unlock"));
    wrap.append(form);
    return;
  }

  // clock
  const endIn = h("input", { class: "t", type: "time", id: "endTime", value: S.endsAt ? S.endsAt.toTimeString().slice(0, 5) : "" });
  wrap.append(h("div", { class: "box" },
    h("h4", { text: "Clock" }),
    h("div", { class: "row" },
      h("button", { class: "btn sm", onclick: () => setEnd(new Date(Date.now() + (CFG.GAME_HOURS || 3) * 3600e3)) }, `Start ${CFG.GAME_HOURS || 3}-hour clock now`),
      S.endsAt ? h("button", { class: "btn ghost sm", onclick: () => setEnd(null) }, "Clear") : null),
    h("label", { class: "f" }, "Or set the end time", h("div", { class: "row" }, endIn,
      h("button", { class: "btn ghost sm", onclick: () => {
        if (!endIn.value) return;
        const [hh, mm] = endIn.value.split(":").map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0);
        if (d < Date.now() - 3600e3) d.setDate(d.getDate() + 1);
        setEnd(d);
      } }, "Set")))));

  // team names
  const nA = h("input", { class: "t", id: "tnA", value: nm("A"), maxlength: "24" });
  const nB = h("input", { class: "t", id: "tnB", value: nm("B"), maxlength: "24" });
  wrap.append(h("div", { class: "box" }, h("h4", { text: "Team names" }), nA, nB,
    h("button", { class: "btn ghost sm", onclick: () => act(() => sb.from("hunts").update({ team_a: nA.value.trim() || "Team A", team_b: nB.value.trim() || "Team B" }).eq("code", S.code), "Names saved") }, "Save names")));

  // judge's call
  const jbox = h("div", { class: "box" }, h("h4", { text: "Judge's call" }), h("p", { class: "muted", style: "margin:0;font-size:13px", text: "Open an item to see both teams' entries side by side." }));
  ITEMS.filter(i => i.type === "judge").forEach(it => {
    const eA = subsFor(it.id, "A").length, eB = subsFor(it.id, "B").length;
    jbox.append(h("div", { class: "jitem" },
      h("div", { class: "jtop" }, h("div", { class: "it", text: it.text }), h("div", { class: "pts", text: fmt(it.points) })),
      h("div", { class: "row" }, h("span", { class: "muted", style: "font-size:13px", text: `Entries: ${nm("A")} ${eA} · ${nm("B")} ${eB}` }), h("button", { class: "link", onclick: () => openSheet(it.id) }, "See entries")),
      awardRow(it)));
  });
  wrap.append(jbox);

  // counters
  const cbox = h("div", { class: "box" }, h("h4", { text: "Penalties & tallies" }));
  ITEMS.filter(i => i.type === "count").forEach(it => {
    cbox.append(h("div", { class: "jitem" }, h("div", { class: "jtop" }, h("div", { class: "it", text: it.text }), h("div", { class: "pts" + (it.points < 0 ? " neg" : ""), text: fmt(it.points) })), stepper(it, "A"), stepper(it, "B")));
  });
  wrap.append(cbox);

  // reset
  const conf = h("input", { class: "t", id: "resetConf", placeholder: "Type RESET", autocomplete: "off" });
  const rbtn = h("button", { class: "btn danger sm", disabled: true, onclick: resetGame }, "Wipe all scores and photos");
  conf.addEventListener("input", () => { rbtn.disabled = conf.value.trim() !== "RESET"; });
  wrap.append(h("div", { class: "box" }, h("h4", { text: "Reset after testing" }),
    h("p", { class: "muted", style: "margin:0;font-size:13px", text: "Clears every submission, award, tally and the clock in this hunt for everyone. Team names and challenges stay. Use this after your test run, not during the game." }), conf, rbtn));

  wrap.append(h("button", { class: "btn ghost", onclick: () => openAdmin() }, "Admin: hunts & challenges"));
  wrap.append(h("button", { class: "btn ghost", onclick: () => { S.judge = false; lsSet("hunt-judge", false); renderAll(); } }, "Leave judge mode"));
}
function setEnd(d) { return act(() => sb.from("hunts").update({ ends_at: d ? d.toISOString() : null }).eq("code", S.code), d ? "Clock set" : "Clock cleared"); }
async function resetGame() {
  const ok = await act(async () => {
    for (const p of [sb.from("submissions").delete().eq("hunt", S.code), sb.from("awards").delete().eq("hunt", S.code), sb.from("counters").delete().eq("hunt", S.code), sb.from("hunts").update({ ends_at: null }).eq("code", S.code)]) {
      const r = await p; if (r.error) throw r.error;
    }
  }, "Game reset");
  if (ok) renderJudge();
}

function awardRow(it) {
  const cur = S.awards[it.id] || null;
  return h("div", { class: "award" },
    h("button", { class: "a", "aria-pressed": String(cur === "A"), onclick: () => award(it.id, cur === "A" ? null : "A") }, nm("A")),
    h("button", { class: "b", "aria-pressed": String(cur === "B"), onclick: () => award(it.id, cur === "B" ? null : "B") }, nm("B")),
    h("button", { class: "btn ghost sm", onclick: () => award(it.id, null), disabled: !cur }, "Clear"));
}
function stepper(it, team) {
  const can = !it.judgeOnly || S.judge;
  return h("div", { class: "stepper" },
    h("span", { class: "tteam " + team.toLowerCase(), text: nm(team) }),
    h("span", { class: "lbl" }),
    can ? h("button", { "aria-label": "Minus one for " + nm(team), onclick: () => bump(it.id, team, -1), disabled: !cnt(it.id, team) }, "−") : h("span"),
    h("span", { class: "v", text: String(cnt(it.id, team)) }),
    can ? h("button", { "aria-label": "Plus one for " + nm(team), onclick: () => bump(it.id, team, 1) }, "+") : h("span"));
}

// ---------- challenge sheet ----------
function closeSheet() { S.openSheet = null; $("#sheetRoot").textContent = ""; document.body.style.overflow = ""; }
function openSheet(cid) { S.openSheet = cid; S.draft = S.draft && S.draft.cid === cid ? S.draft : { cid, file: null, caption: "" }; renderSheet(); }
function renderSheet() {
  const root = $("#sheetRoot");
  const cid = S.openSheet;
  if (!cid) { root.textContent = ""; return; }
  const it = BY_ID[cid];
  if (!it) { closeSheet(); return; }
  document.body.style.overflow = "hidden";
  const keepScroll = root.querySelector(".sheet") ? root.querySelector(".sheet").scrollTop : 0;
  root.textContent = "";
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": it.text });
  const typeLabel = it.type === "judge" ? "Judge's call · one team wins" : it.type === "count" ? "Tally · " + fmt(it.points) + " each" : "Each team, once";
  sheet.append(h("div", { class: "sheethead" },
    h("div", null, h("div", { class: "eyebrow", text: typeLabel }), h("h3", { text: it.text }), it.note ? h("div", { class: "in", text: it.note }) : null),
    h("div", { style: "display:grid;gap:6px;justify-items:end" }, h("button", { class: "close", "aria-label": "Close", onclick: closeSheet }, "×"), h("div", { class: "bigpts" + (it.points < 0 ? " neg" : ""), text: fmt(it.points) }))));

  if (it.type === "count") {
    const box = h("div", { class: "box" }, h("h4", { text: "Tally" }), stepper(it, "A"), stepper(it, "B"));
    if (it.judgeOnly && !S.judge) box.append(h("p", { class: "muted", style: "margin:0;font-size:13px", text: "Only the judge can change this one." }));
    sheet.append(box);
  } else {
    if (it.type === "judge") {
      const w = S.awards[it.id];
      sheet.append(h("div", { class: "box" }, h("h4", { text: "Winner" }),
        S.judge ? awardRow(it) : h("p", { style: "margin:0", text: w ? nm(w) + " took this one." : "Not awarded yet. The judge decides at the final bar." })));
    }
    sheet.append(uploadBox(it));
  }

  const entries = subsFor(it.id, null, true);
  const ebox = h("div", { class: "box" }, h("h4", { text: entries.length ? `Entries (${entries.length})` : "Entries" }));
  if (!entries.length) ebox.append(h("p", { class: "muted", style: "margin:0", text: "Nobody has posted this yet." }));
  else { const g = h("div", { class: "grid" }); entries.forEach(s => g.append(postCard(s, true))); ebox.append(g); }
  if (it.type !== "count") sheet.append(ebox);

  const scrim = h("div", { class: "scrim", onclick: e => { if (e.target === scrim) closeSheet(); } }, sheet);
  root.append(scrim);
  sheet.scrollTop = keepScroll;
}

function uploadBox(it) {
  const team = S.me.team;
  const mine = subsFor(it.id, team).length;
  const d = S.draft;
  const box = h("div", { class: "box" });
  const title = it.type === "judge" ? `Enter for ${nm(team)}` : mine ? `${nm(team)} has this. Add another?` : `Post it for ${nm(team)}`;
  box.append(h("h4", { text: title }));
  const input = h("input", { type: "file", accept: "image/*,video/*", id: "fileIn" });
  const label = h("label", { class: "filebtn" }, input, d.file ? "Change photo or video" : "Take or choose a photo or video");
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > MAX_BYTES && !f.type.startsWith("image/")) { d.error = "That video is over 50 MB. Trim it, or post it in the group chat and log a photo here."; d.file = null; }
    else { d.file = f; d.error = null; }
    renderSheet();
  });
  box.append(label);
  if (d.file) {
    if (d.previewFor !== d.file) { if (d.previewUrl) URL.revokeObjectURL(d.previewUrl); d.previewUrl = URL.createObjectURL(d.file); d.previewFor = d.file; }
    box.append(d.file.type.startsWith("video") ? h("video", { class: "preview", src: d.previewUrl, muted: true, playsinline: true, controls: true }) : h("img", { class: "preview", src: d.previewUrl, alt: "Preview" }));
  }
  const cap = h("textarea", { class: "t", id: "capIn", rows: "2", maxlength: "280", placeholder: "Caption (optional)" });
  cap.value = d.caption || "";
  cap.addEventListener("input", () => { d.caption = cap.value; });
  box.append(cap);
  if (d.error) box.append(h("p", { class: "err", text: d.error }));
  const btn = h("button", { class: "btn", disabled: !d.file || d.busy, onclick: () => submit(it) }, d.busy ? [h("span", { class: "spin" }), " Uploading…"] : "Submit");
  box.append(btn);
  return box;
}

async function shrink(file) {
  if (!file.type.startsWith("image/") || /gif|svg/.test(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
    return blob ? { blob, type: "image/jpeg", ext: "jpg" } : null;
  } catch (e) { return null; }
}

async function submit(it) {
  const d = S.draft; if (!d.file || d.busy) return;
  d.busy = true; d.error = null; renderSheet();
  try {
    const small = await shrink(d.file);
    const blob = small ? small.blob : d.file;
    if (blob.size > MAX_BYTES) throw new Error("big");
    const type = small ? small.type : (d.file.type || "application/octet-stream");
    const ext = small ? small.ext : ((d.file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin");
    const path = `${S.code}/${S.me.team}/${it.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (up.error) throw up.error;
    const ins = await sb.from("submissions").insert({ hunt: S.code, challenge_id: it.id, team: S.me.team, player: S.me.name, media_path: path, media_type: type, caption: (d.caption || "").trim() || null });
    if (ins.error) throw ins.error;
    if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    S.draft = { cid: it.id, file: null, caption: "" };
    toast(it.type === "judge" ? "Entry posted" : `${nm(S.me.team)} ${it.points > 0 ? "+" : ""}${fmt(it.points)}`);
    await loadAll().catch(() => {});
    renderAll();
  } catch (e) {
    console.warn(e);
    d.busy = false;
    d.error = e && e.message === "big" ? "That file is over 50 MB. Trim it or post it in the group chat." : "Upload failed. Check your signal and tap Submit again. Your photo is still here.";
    renderSheet();
    return;
  }
}

function renderAll() {
  if (!S.me) return;
  renderBoard();
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  ["list", "feed", "judge"].forEach(t => { $("#view-" + t).hidden = S.tab !== t; });
  if (S.tab === "list") renderList();
  if (S.tab === "feed") renderFeed();
  if (S.tab === "judge") {
    // don't wipe inputs the judge is typing into
    const a = document.activeElement;
    if (!(a && $("#view-judge").contains(a) && a.tagName === "INPUT")) renderJudge();
  }
  if (S.openSheet && !(S.draft && S.draft.busy)) {
    const a = document.activeElement;
    if (!(a && a.id === "capIn")) renderSheet();
  }
}

// ---------- join ----------
function startJoin() {
  show("#screen-join");
  $("#joinHunt").textContent = S.hunt.name;
  let team = S.me && S.me.code === S.code ? S.me.team : null;
  const name = $("#joinName"); name.value = S.me ? S.me.name : "";
  const go = $("#joinGo");
  const upd = () => {
    go.disabled = !(name.value.trim() && team);
    $("#joinPick").querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.team === team)); b.textContent = nm(b.dataset.team); });
  };
  $("#joinPick").querySelectorAll("button").forEach(b => { b.onclick = () => { team = b.dataset.team; upd(); }; });
  name.oninput = upd;
  $("#joinForm").onsubmit = e => {
    e.preventDefault(); if (go.disabled) return;
    S.me = { name: name.value.trim(), team, code: S.code }; lsSet("hunt-me", S.me);
    show("#app"); renderAll();
  };
  upd();
}
$("#switchMe").addEventListener("click", startJoin);
$("#changeHunt").addEventListener("click", () => showCode());
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.tab; renderAll(); window.scrollTo(0, 0); }));
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if ($("#lightbox")) closeLightbox();
  else if (S.openSheet) closeSheet();
});

// ---------- hunt code ----------
function loadError(e) {
  console.warn(e);
  $("#errText").textContent = "The app couldn't load the game from Supabase. Check your signal. If this is the first run, check that setup.sql ran and config.js has the right URL and key. (" + (e && e.message ? e.message : "unknown error") + ")";
  show("#screen-error");
}
function showCode(msg) {
  closeSheet();
  S.code = null; S.hunt = null; lsSet("hunt-code", null);
  show("#screen-code");
  $("#codeIn").value = "";
  $("#codeErr").textContent = msg || "";
  $("#codeErr").hidden = !msg;
}
async function enterHunt(code) {
  S.code = code; seenSubs = null;
  if (!(await loadAll())) { showCode(`No hunt with the code ${code}. Check it and try again.`); return; }
  lsSet("hunt-code", code);
  if (S.me && S.me.code === code) { show("#app"); renderAll(); } else startJoin();
}
$("#codeForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#codeIn").value.trim().toUpperCase();
  if (!code) return;
  $("#codeGo").disabled = true;
  try { await enterHunt(code); } catch (err) { loadError(err); }
  $("#codeGo").disabled = false;
});
$("#openAdmin").addEventListener("click", () => openAdmin());

// ---------- admin ----------
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const shareLink = code => location.origin + location.pathname + "?hunt=" + encodeURIComponent(code);

async function openAdmin() {
  closeSheet();
  show("#screen-admin");
  S.editHunt = null;
  await refreshAdmin();
}
function closeAdmin() {
  if (S.code && S.hunt) enterHunt(S.code).catch(loadError);
  else showCode();
}
async function refreshAdmin() {
  if (S.judge) {
    try {
      const [hunts, custom] = await Promise.all([
        q(sb.from("hunts").select("*").order("created_at", { ascending: false })),
        q(sb.from("challenges").select("*").order("created_at"))
      ]);
      S.adminHunts = hunts || [];
      S.custom = custom || [];
    } catch (e) { console.warn(e); toast("Couldn't load. Check your signal."); }
  }
  renderAdmin();
}
async function adminAct(fn, okMsg) {
  try { const r = await fn(); if (r && r.error) throw r.error; if (okMsg) toast(okMsg); await refreshAdmin(); return true; }
  catch (e) { console.warn(e); toast("Didn't save. " + (e && e.message ? e.message : "Check your signal and try again.")); return false; }
}

function renderAdmin() {
  const root = $("#adminRoot"); root.textContent = "";
  root.append(h("div", { class: "adminhead" },
    h("div", null, h("div", { class: "eyebrow", text: "Admin" }), h("h1", { text: S.adminTab === "hunts" ? "Hunts" : "Challenges" })),
    h("button", { class: "btn ghost sm", onclick: closeAdmin }, S.code && S.hunt ? "Back to hunt" : "Back")));
  if (!S.judge) {
    const pin = h("input", { class: "t", type: "password", inputmode: "numeric", placeholder: "Judge PIN", autocomplete: "off" });
    const err = h("p", { class: "err", hidden: true, text: "Wrong PIN." });
    root.append(h("form", { class: "box", onsubmit: e => {
      e.preventDefault();
      if (pin.value.trim() === String(CFG.JUDGE_PIN)) { S.judge = true; lsSet("hunt-judge", true); refreshAdmin(); }
      else err.hidden = false;
    } }, h("h4", { text: "Judge PIN needed" }), h("p", { class: "muted", style: "margin:0", text: "The admin page uses the same PIN as the Judge tab." }), pin, err, h("button", { class: "btn" }, "Unlock")));
    return;
  }
  const seg = h("div", { class: "seg", role: "group" });
  [["hunts", "Hunts"], ["challenges", "Challenges"]].forEach(([k, label]) =>
    seg.append(h("button", { "aria-pressed": String(S.adminTab === k), onclick: () => { S.adminTab = k; S.editHunt = null; renderAdmin(); } }, label)));
  root.append(seg);
  if (S.adminTab === "hunts") root.append(S.editHunt ? huntForm() : huntList());
  else root.append(challengeForm(), challengeList());
}

function huntList() {
  const wrap = h("div", { class: "admin" });
  wrap.append(h("button", { class: "btn", onclick: () => {
    S.editHunt = { isNew: true, code: randomCode(), name: "", team_a: "Team A", team_b: "Team B", sel: new Set(catalog().flatMap(c => c.items.map(i => i.id))) };
    renderAdmin();
  } }, "New hunt"));
  if (!S.adminHunts.length) wrap.append(h("p", { class: "empty", text: "No hunts yet." }));
  S.adminHunts.forEach(hu => {
    const n = hu.challenge_ids ? hu.challenge_ids.length : null;
    wrap.append(h("div", { class: "box" },
      h("div", { class: "jtop" }, h("div", { class: "it", text: hu.name }), h("span", { class: "codetag", text: hu.code })),
      h("div", { class: "muted", style: "font-size:13px", text: `${hu.team_a} vs ${hu.team_b} · ${n == null ? "all challenges" : n + " challenge" + (n === 1 ? "" : "s")}` }),
      h("div", { class: "row" },
        h("button", { class: "btn ghost sm", onclick: () => {
          S.editHunt = { isNew: false, code: hu.code, name: hu.name, team_a: hu.team_a, team_b: hu.team_b, sel: new Set(hu.challenge_ids || catalog().flatMap(c => c.items.map(i => i.id))) };
          renderAdmin();
        } }, "Edit"),
        h("button", { class: "btn ghost sm", onclick: async () => {
          const link = shareLink(hu.code);
          try { await navigator.clipboard.writeText(link); toast("Link copied"); } catch (e) { prompt("Copy this link:", link); }
        } }, "Copy link"),
        h("button", { class: "btn ghost sm", onclick: () => enterHunt(hu.code).catch(loadError) }, "Open"),
        h("button", { class: "btn ghost sm danger-text", onclick: () => {
          if (prompt(`Delete "${hu.name}"? This removes its scores and posts for good. Type ${hu.code} to confirm.`) !== hu.code) return;
          if (S.code === hu.code) { S.code = null; S.hunt = null; lsSet("hunt-code", null); }
          adminAct(() => sb.from("hunts").delete().eq("code", hu.code), "Hunt deleted");
        } }, "Delete"))));
  });
  return wrap;
}

function huntForm() {
  const d = S.editHunt;
  const wrap = h("div", { class: "admin" });
  const name = h("input", { class: "t", maxlength: "60", placeholder: "e.g. Brooklyn bar crawl", value: d.name });
  name.addEventListener("input", () => { d.name = name.value; });
  const code = h("input", { class: "t code", maxlength: "12", value: d.code, disabled: !d.isNew, autocapitalize: "characters", spellcheck: "false" });
  code.addEventListener("input", () => { d.code = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); code.value = d.code; });
  const tA = h("input", { class: "t", maxlength: "24", value: d.team_a }); tA.addEventListener("input", () => { d.team_a = tA.value; });
  const tB = h("input", { class: "t", maxlength: "24", value: d.team_b }); tB.addEventListener("input", () => { d.team_b = tB.value; });
  const err = h("p", { class: "err", hidden: true });
  const count = h("span", { class: "muted", style: "font-size:13px" });
  const updCount = () => { count.textContent = d.sel.size + " selected"; };
  updCount();

  wrap.append(h("div", { class: "box" }, h("h4", { text: d.isNew ? "New hunt" : "Edit hunt" }),
    h("label", { class: "f" }, "Name", name),
    h("label", { class: "f" }, d.isNew ? "Join code (3–12 letters or numbers)" : "Join code (can't be changed)", code),
    h("div", { class: "row2" }, h("label", { class: "f" }, "Team A name", tA), h("label", { class: "f" }, "Team B name", tB))));

  const picker = h("div", { class: "box" }, h("div", { class: "jtop" }, h("h4", { text: "Challenges" }), count));
  catalog().forEach(c => {
    const boxes = [];
    const all = h("input", { type: "checkbox" });
    const syncAll = () => { const n = c.items.filter(i => d.sel.has(i.id)).length; all.checked = n === c.items.length; all.indeterminate = n > 0 && n < c.items.length; };
    all.addEventListener("change", () => { c.items.forEach(i => all.checked ? d.sel.add(i.id) : d.sel.delete(i.id)); boxes.forEach(b => { b.checked = all.checked; }); updCount(); syncAll(); });
    const ul = h("div", { class: "picklist" });
    c.items.forEach(i => {
      const cb = h("input", { type: "checkbox" }); cb.checked = d.sel.has(i.id); boxes.push(cb);
      cb.addEventListener("change", () => { cb.checked ? d.sel.add(i.id) : d.sel.delete(i.id); updCount(); syncAll(); });
      ul.append(h("label", { class: "pickrow" }, cb, h("span", { class: "pts" + (i.points < 0 ? " neg" : ""), text: fmt(i.points) }), h("span", null, i.text, i.type === "judge" ? h("span", { class: "tag", text: "Judge" }) : i.type === "count" ? h("span", { class: "tag", text: "Tally" }) : null)));
    });
    syncAll();
    picker.append(h("div", { class: "pickcat" }, h("label", { class: "pickrow head" }, all, h("span", { text: c.name })), ul));
  });
  wrap.append(picker, err);

  wrap.append(h("div", { class: "row" },
    h("button", { class: "btn", onclick: async () => {
      err.hidden = true;
      const fail = m => { err.textContent = m; err.hidden = false; };
      if (!d.name.trim()) return fail("Give the hunt a name.");
      if (!/^[A-Z0-9]{3,12}$/.test(d.code)) return fail("The code needs 3–12 letters or numbers.");
      if (!d.sel.size) return fail("Pick at least one challenge.");
      // keep catalog order so the list reads the same as the picker
      const ids = catalog().flatMap(c => c.items.map(i => i.id)).filter(id => d.sel.has(id));
      const row = { name: d.name.trim(), team_a: d.team_a.trim() || "Team A", team_b: d.team_b.trim() || "Team B", challenge_ids: ids };
      if (d.isNew && S.adminHunts.some(x => x.code === d.code)) return fail("That code is already used by another hunt.");
      const ok = await adminAct(() => d.isNew ? sb.from("hunts").insert(Object.assign({ code: d.code }, row)) : sb.from("hunts").update(row).eq("code", d.code), d.isNew ? "Hunt created" : "Hunt saved");
      if (ok) { S.editHunt = null; renderAdmin(); }
    } }, d.isNew ? "Create hunt" : "Save"),
    h("button", { class: "btn ghost", onclick: () => { S.editHunt = null; renderAdmin(); } }, "Cancel")));
  return wrap;
}

function challengeForm() {
  const cats = catalog();
  const text = h("textarea", { class: "t", rows: "2", maxlength: "200", placeholder: "e.g. Photo with a pigeon on someone's head" });
  const note = h("input", { class: "t", maxlength: "140", placeholder: "Optional, e.g. Any pigeon counts." });
  const pts = h("input", { class: "t", type: "number", inputmode: "numeric", step: "1", value: "100" });
  const cat = h("select", { class: "t" }, cats.map(c => h("option", { value: c.id }, c.name)), h("option", { value: "__new" }, "+ New category…"));
  const newCat = h("input", { class: "t", maxlength: "40", placeholder: "New category name", hidden: true });
  cat.addEventListener("change", () => { newCat.hidden = cat.value !== "__new"; });
  const type = h("select", { class: "t" },
    h("option", { value: "once" }, "Photo: each team can do it once"),
    h("option", { value: "judge" }, "Judge's call: one team wins it"),
    h("option", { value: "count" }, "Tally: tap + each time it happens"));
  const jo = h("input", { type: "checkbox" }); jo.checked = true;
  const joRow = h("label", { class: "pickrow", hidden: true }, jo, h("span", { text: "Only the judge can change the tally" }));
  type.addEventListener("change", () => { joRow.hidden = type.value !== "count"; });
  const hunts = S.adminHunts.filter(x => x.challenge_ids);
  const huntBoxes = hunts.map(x => { const cb = h("input", { type: "checkbox" }); cb.checked = x.code === S.code; return [x, cb]; });
  const err = h("p", { class: "err", hidden: true });

  const box = h("div", { class: "box" }, h("h4", { text: "New challenge" }),
    h("label", { class: "f" }, "Description", text),
    h("label", { class: "f" }, "Note", note),
    h("div", { class: "row2" }, h("label", { class: "f" }, "Points (negative for a penalty)", pts), h("label", { class: "f" }, "Category", cat)),
    newCat,
    h("label", { class: "f" }, "Type", type),
    joRow);
  if (huntBoxes.length) box.append(h("div", { class: "f", style: "display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--muted)" }, "Add it to these hunts",
    huntBoxes.map(([x, cb]) => h("label", { class: "pickrow" }, cb, h("span", null, x.name, " ", h("span", { class: "codetag", text: x.code }))))));
  const allHunts = S.adminHunts.filter(x => !x.challenge_ids);
  if (allHunts.length) box.append(h("p", { class: "muted", style: "margin:0;font-size:13px", text: `Hunts that include all challenges get it automatically: ${allHunts.map(x => x.name).join(", ")}.` }));
  box.append(err, h("button", { class: "btn", onclick: async () => {
    err.hidden = true;
    const fail = m => { err.textContent = m; err.hidden = false; };
    const p = Number(pts.value);
    if (!text.value.trim()) return fail("Add a description.");
    if (!Number.isInteger(p) || p === 0) return fail("Points must be a whole number, not 0.");
    let cat_id = cat.value, cat_name;
    if (cat_id === "__new") {
      cat_name = newCat.value.trim();
      if (!cat_name) return fail("Name the new category.");
      const same = cats.find(c => c.name.toLowerCase() === cat_name.toLowerCase());
      cat_id = same ? same.id : "c-" + (cat_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cat");
      if (same) cat_name = same.name;
    } else cat_name = cats.find(c => c.id === cat_id).name;
    const id = "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const ok = await adminAct(async () => {
      const r = await sb.from("challenges").insert({ id, cat_id, cat_name, text: text.value.trim(), note: note.value.trim() || null, points: p, type: type.value, judge_only: type.value === "count" && jo.checked });
      if (r.error) return r;
      for (const [x, cb] of huntBoxes) {
        if (!cb.checked) continue;
        const r2 = await sb.from("hunts").update({ challenge_ids: x.challenge_ids.concat(id) }).eq("code", x.code);
        if (r2.error) return r2;
      }
    }, "Challenge created");
    if (ok) window.scrollTo(0, 0);
  } }, "Create challenge"));
  return box;
}

function challengeList() {
  const box = h("div", { class: "box" }, h("h4", { text: "Challenges you've made" }));
  if (!S.custom.length) box.append(h("p", { class: "muted", style: "margin:0", text: "None yet. The built-in challenges live in challenges.js." }));
  S.custom.slice().reverse().forEach(r => {
    const used = S.adminHunts.filter(x => !x.challenge_ids || x.challenge_ids.includes(r.id)).length;
    box.append(h("div", { class: "jitem" },
      h("div", { class: "jtop" }, h("div", { class: "it", text: r.text }), h("div", { class: "pts" + (r.points < 0 ? " neg" : ""), text: fmt(r.points) })),
      h("div", { class: "row" },
        h("span", { class: "muted", style: "font-size:13px", text: `${r.cat_name} · ${r.type === "judge" ? "Judge's call" : r.type === "count" ? "Tally" : "Photo"} · in ${used} hunt${used === 1 ? "" : "s"}` }),
        h("button", { class: "link danger-text", onclick: () => {
          if (!confirm(`Delete "${r.text}"?` + (used ? ` It disappears from ${used} hunt${used === 1 ? "" : "s"}, along with any points scored on it.` : ""))) return;
          adminAct(() => sb.from("challenges").delete().eq("id", r.id), "Challenge deleted");
        } }, "Delete"))));
  });
  return box;
}

// ---------- boot ----------
(async function boot() {
  const urlCode = new URLSearchParams(location.search).get("hunt");
  if (urlCode) { S.code = urlCode.trim().toUpperCase(); history.replaceState(null, "", location.pathname); }
  subscribe();
  if (!S.code) { showCode(); return; }
  try { await enterHunt(S.code); } catch (e) { loadError(e); }
})();
})();
