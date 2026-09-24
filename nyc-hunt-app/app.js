(function () {
"use strict";

const CFG = window.HUNT_CONFIG || {};
const CATS = window.CATEGORIES || [];
const ITEMS = [];
CATS.forEach(c => c.items.forEach(it => ITEMS.push(Object.assign({ cat: c.id }, it))));
const BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
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
function show(id) { ["#screen-config", "#screen-error", "#screen-join", "#app"].forEach(s => { $(s).hidden = s !== id; }); }

// ---------- config check ----------
if (!CFG.SUPABASE_URL || /YOUR-PROJECT/.test(CFG.SUPABASE_URL) || !CFG.SUPABASE_KEY || /PASTE-YOUR/.test(CFG.SUPABASE_KEY) || !window.supabase) {
  show("#screen-config");
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: false } });

// ---------- state ----------
const S = {
  teams: { A: "Team A", B: "Team B" },
  subs: [], counters: {}, awards: {}, endsAt: null,
  me: lsGet("hunt-me", null),
  judge: lsGet("hunt-judge", false),
  tab: "list", cat: lsGet("hunt-cat", "all"), feedFilter: "all",
  openSheet: null
};
const nm = t => S.teams[t] || ("Team " + t);
const other = t => (t === "A" ? "B" : "A");
const mediaUrl = path => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

// ---------- data ----------
async function q(p) { const r = await p; if (r.error) throw r.error; return r.data; }
async function loadAll() {
  const [teams, subs, counters, awards, game] = await Promise.all([
    q(sb.from("teams").select("*")),
    q(sb.from("submissions").select("*").order("created_at", { ascending: false })),
    q(sb.from("counters").select("*")),
    q(sb.from("awards").select("*")),
    q(sb.from("game").select("*"))
  ]);
  (teams || []).forEach(t => { S.teams[t.id] = t.name; });
  S.subs = subs || [];
  S.counters = {};
  (counters || []).forEach(c => { (S.counters[c.challenge_id] = S.counters[c.challenge_id] || {})[c.team] = c.count; });
  S.awards = {};
  (awards || []).forEach(a => { if (a.team) S.awards[a.challenge_id] = a.team; });
  S.endsAt = game && game[0] && game[0].ends_at ? new Date(game[0].ends_at) : null;
}
let reloadT, reloading = false, reloadAgain = false;
function scheduleReload(delay) {
  clearTimeout(reloadT);
  reloadT = setTimeout(async () => {
    if (reloading) { reloadAgain = true; return; }
    reloading = true;
    try { await loadAll(); renderAll(); } catch (e) { console.warn(e); }
    reloading = false;
    if (reloadAgain) { reloadAgain = false; scheduleReload(50); }
  }, delay == null ? 250 : delay);
}
function subscribe() {
  const ch = sb.channel("hunt-live");
  ["teams", "submissions", "counters", "awards", "game"].forEach(t =>
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
      : h("img", { class: "media", src: mediaUrl(s.media_path), loading: "lazy", alt: it ? it.text : "Submission" }))
    : null;
  const card = h("article", { class: "post" + (s.rejected ? " rej" : "") },
    media,
    s.rejected ? h("span", { class: "rejtag", text: "Rejected" }) : null,
    h("div", { class: "meta" },
      compact ? null : h("div", { class: "ch" }, it ? it.text : s.challenge_id),
      h("div", { class: "who" }, h("span", { class: "tteam " + s.team.toLowerCase(), text: nm(s.team) }), h("span", { text: s.player || "" }), h("span", { class: "when", text: "· " + ago(s.created_at) })),
      s.caption ? h("div", { class: "cap", text: s.caption }) : null));
  if (S.judge) {
    card.append(h("div", { class: "judgebar" },
      h("button", { class: "btn ghost sm", onclick: async e => { e.stopPropagation(); await act(() => sb.from("submissions").update({ rejected: !s.rejected }).eq("id", s.id), s.rejected ? "Restored" : "Rejected"); } }, s.rejected ? "Restore" : "Reject"),
      compact ? null : h("button", { class: "btn ghost sm", onclick: () => openSheet(s.challenge_id) }, "Open challenge")));
  }
  return card;
}

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
function bump(cid, team, d) { return act(() => sb.rpc("bump", { cid, t: team, d })); }
function award(cid, team) {
  return act(() => team ? sb.from("awards").upsert({ challenge_id: cid, team, updated_at: new Date().toISOString() }) : sb.from("awards").delete().eq("challenge_id", cid),
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
    h("button", { class: "btn ghost sm", onclick: () => act(() => sb.from("teams").upsert([{ id: "A", name: nA.value.trim() || "Team A" }, { id: "B", name: nB.value.trim() || "Team B" }]), "Names saved") }, "Save names")));

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
    h("p", { class: "muted", style: "margin:0;font-size:13px", text: "Clears every submission, award, tally and the clock for everyone. Team names stay. Use this after your test run, not during the game." }), conf, rbtn));

  wrap.append(h("button", { class: "btn ghost", onclick: () => { S.judge = false; lsSet("hunt-judge", false); renderAll(); } }, "Leave judge mode"));
}
function setEnd(d) { return act(() => sb.from("game").upsert({ id: 1, ends_at: d ? d.toISOString() : null }), d ? "Clock set" : "Clock cleared"); }
async function resetGame() {
  const ok = await act(async () => {
    for (const p of [sb.from("submissions").delete().not("id", "is", null), sb.from("awards").delete().neq("challenge_id", ""), sb.from("counters").delete().neq("challenge_id", ""), sb.from("game").upsert({ id: 1, ends_at: null })]) {
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
    const path = `${S.me.team}/${it.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (up.error) throw up.error;
    const ins = await sb.from("submissions").insert({ challenge_id: it.id, team: S.me.team, player: S.me.name, media_path: path, media_type: type, caption: (d.caption || "").trim() || null });
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
  let team = S.me ? S.me.team : null;
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
    S.me = { name: name.value.trim(), team }; lsSet("hunt-me", S.me);
    show("#app"); renderAll();
  };
  upd();
}
$("#switchMe").addEventListener("click", startJoin);
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => { S.tab = b.dataset.tab; renderAll(); window.scrollTo(0, 0); }));
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.openSheet) closeSheet(); });

// ---------- boot ----------
(async function boot() {
  try { await loadAll(); }
  catch (e) {
    console.warn(e);
    $("#errText").textContent = "The app couldn't load the game from Supabase. Check your signal. If this is the first run, check that setup.sql ran and config.js has the right URL and key. (" + (e && e.message ? e.message : "unknown error") + ")";
    show("#screen-error");
    return;
  }
  subscribe();
  if (S.me) { show("#app"); renderAll(); } else startJoin();
})();
})();
