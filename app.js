import {
  CATS, CAT_LABEL, STEPS, STEP_LABEL, STAGE_LABEL, BENCH, BENCH_LABEL,
  taskList, pageProgress, stage, overall, deadlineSummary,
  daysUntil, isOverdue, furthestAlong, topProofers, priorityBoard, PRIORITY, AWARD_LEGEND,
} from "./logic.js";

// ---------- state ----------
const S = { settings: null, roster: [], pages: [], me: null, names: [], route: "", ui: { assign: { sel: new Set(), filter: "", unassigned: false, student: "", group: "", dl: "" }, proofTab: "first", lbTab: "progress", pagesFilter: "all", pagesSearch: "", sprint: 1, dl: { overdue: false, student: "" }, reqTab: "request", req: { search: "", group: "", student: "" } } };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdv = () => S.me?.role === "advisor";
const isReviewer = () => isAdv() || !!S.roster.find((r) => r.name === S.me?.name)?.editor;
const pendingReqs = (p) => (p.requests || []).filter((r) => r.status !== "declined");
const T = () => S.settings.templates;
const fmtDate = (d) => !d ? "no date set" : new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pageBy = (n) => S.pages.find((p) => p.num === Number(n));

// ---------- api ----------
function setSync(kind) { const el = $("#sync"); el.className = "pill " + kind; el.textContent = kind === "ok" ? "✓ Synced" : kind === "busy" ? "Syncing…" : "⚠ Offline"; }
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 3500); }
function creds() { try { return JSON.parse(localStorage.getItem("yh-creds") || "null"); } catch { return null; } }
async function api(path, body) {
  const c = creds() || {};
  const headers = { "content-type": "application/json", "x-name": encodeURIComponent(c.name || ""), "x-code": c.code || "", "x-advisor": c.advisor || "" };
  setSync("busy");
  try {
    const res = await fetch("/api/" + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "login") { signOut(); return null; }
    if (!res.ok) { setSync("ok"); toast(data.error || "Something went wrong.", true); return null; }
    setSync("ok"); return data;
  } catch { setSync("bad"); toast("Can't reach the server. Check your internet connection.", true); return null; }
}
function mergePage(p) { if (!p) return; const i = S.pages.findIndex((x) => x.num === p.num); if (i >= 0) S.pages[i] = p; else S.pages.push(p); S.pages.sort((a, b) => a.num - b.num); }
async function refresh(quiet) {
  // Sends the version we already have. If nothing changed on the server it answers "unchanged" (tiny, cheap).
  const d = await api("state?v=" + (S.version ?? ""));
  if (!d || d.unchanged) return;
  Object.assign(S, { settings: d.settings, roster: d.roster, pages: d.pages, me: d.me, version: d.version });
  if (!quiet) render();
}

// ---------- auth ----------
async function showLogin() {
  $("#shell").classList.add("hidden"); $("#login").classList.remove("hidden");
  const r = await fetch("/api/roster").then((x) => x.json()).catch(() => ({ names: [] }));
  S.names = r.names || [];
  $("#login").innerHTML = `<form class="box" id="lf">
    <div class="brand">📖 YEARBOOK HUB</div>
    <p class="muted">Sign in to track your pages.</p>
    <div id="studentFields">
      <label for="lname">Your name</label>
      <select id="lname"><option value="">Choose your name…</option>${S.names.map((n) => `<option>${esc(n)}</option>`).join("")}</select>
      <label for="lcode">Class code</label>
      <input id="lcode" type="password" autocomplete="off">
    </div>
    <div id="advField" class="hidden"><label for="ladv">Advisor passcode</label><input id="ladv" type="password" autocomplete="off"></div>
    <p><button type="button" class="link-btn" id="toggleAdv">I'm the advisor</button></p>
    <button class="btn red" style="width:100%">Sign in</button>
    <div id="lerr" class="err"></div></form>`;
  let adv = false;
  $("#toggleAdv").onclick = () => { adv = !adv; $("#advField").classList.toggle("hidden", !adv); $("#studentFields").classList.toggle("hidden", adv); $("#toggleAdv").textContent = adv ? "I'm a student" : "I'm the advisor"; };
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    if (!adv && !$("#lname").value) { $("#lerr").textContent = "Choose your name first."; return; }
    if (adv && !$("#ladv").value) { $("#lerr").textContent = "Type your advisor passcode."; return; }
    const c = adv ? { advisor: $("#ladv").value } : { name: $("#lname").value, code: $("#lcode").value };
    localStorage.setItem("yh-creds", JSON.stringify(c));
    const res = await api("login", {});
    if (!res) { localStorage.removeItem("yh-creds"); $("#lerr").textContent = "That name and code (or passcode) didn't work. Try again."; return; }
    start();
  };
}
function signOut() { localStorage.removeItem("yh-creds"); showLogin(); }

// ---------- nav ----------
const NAV = [
  ["home", "🏠", "Dashboard"], ["pages", "📄", "Pages"], ["requests", "🙋", "Page Requests"], ["proof", "🔍", "Pages to Proof"],
  ["spotlight", "🏆", "Spotlight"], ["deadlines", "📅", "Deadlines"], ["assign", "🧩", "Assign Pages", true], ["admin", "⚙️", "Admin", true],
];
function renderNav() {
  const cur = S.route.split("/")[0] || "home";
  $("#nav").innerHTML = NAV.filter((n) => !n[3] || isAdv()).map(([id, ic, label]) =>
    `<a href="#/${id}" class="${cur === id || (id === "pages" && cur === "page") ? "active" : ""}">${ic} ${label}</a>`).join("");
  $("#who").textContent = S.me ? (isAdv() ? "Advisor" : S.me.name) : "";
}

// ---------- helpers for views ----------
const bar = (pct, cls = "") => `<div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>`;
const stagePill = (p) => { const s = stage(p, T()); return `<span class="stagepill s-${s}">${STAGE_LABEL[s]}</span>`; };
const pageLink = (p) => `<a class="chip link" href="#/page/${p.num}">Pg ${p.num}</a>`;
const stat = (l, v, n = "") => `<div class="card stat"><div class="lbl">${l}</div><div class="val">${v}</div><div class="note">${n}</div></div>`;
const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
function canEdit(p) { return isAdv() || p.assignees.includes(S.me.name); }
const sets = () => S.settings.deadlineSets || [];
const setOf = (p) => sets().find((s) => s.id === p.deadline);
function allDates() {
  return sets().flatMap((s) => BENCH.filter((k) => s.dates?.[k]).map((k) => ({ set: s.name, label: BENCH_LABEL[k], date: s.dates[k] }))).sort((a, b) => a.date.localeCompare(b.date));
}
function when(date) {
  if (!date) return "No date set";
  const left = daysUntil(date);
  return `${fmtDate(date)} • ${isOverdue(date) ? "passed" : left === 0 ? "due today" : left + " days left"}`;
}
function ranges(nums) {
  const a = [...nums].sort((x, y) => x - y), out = []; let s = a[0], p = a[0];
  for (let i = 1; i <= a.length; i++) { if (a[i] === p + 1) { p = a[i]; continue; } out.push(s === p ? `${s}` : `${s}–${p}`); s = a[i]; p = a[i]; }
  return out.join(", ");
}

// ---------- views ----------
function viewHome() {
  const o = overall(S.pages, T());
  const sums = sets().map((s) => deadlineSummary(S.pages, T(), s));
  const next = allDates().find((d) => daysUntil(d.date) >= 0);
  const hr = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const stages = { building: 0, first: 0, second: 0, editor: 0, final: 0, done: 0 };
  S.pages.forEach((p) => stages[stage(p, T())]++);
  const mine = isAdv() ? [] : S.pages.filter((p) => p.assignees.includes(S.me.name));
  const unassigned = S.pages.filter((p) => !p.assignees.length).length;
  const pendReq = isReviewer() ? S.pages.reduce((n, p) => n + pendingReqs(p).length, 0) : 0;
  const fa = furthestAlong(S.pages, S.roster, T()).slice(0, 5), tp = topProofers(S.pages, S.roster).slice(0, 5);
  const showSpot = S.settings.spotlight || isAdv();
  return `<h1>${greet}${isAdv() ? "" : ", " + esc(S.me.name.split(" ")[0])}! 👋</h1><p class="sub">Yearbook Class • Production Hub</p>
  ${isAdv() && unassigned ? `<div class="banner"><b>${unassigned} pages</b> don't have students yet. <a href="#/assign">Assign pages →</a></div>` : ""}
  ${pendReq ? `<div class="banner" style="background:#eef4ff;border-color:#c7d8fb;color:#1e3a8a"><b>${pendReq} page request${pendReq === 1 ? "" : "s"}</b> waiting for review. <a href="#/requests">Review requests →</a></div>` : ""}
  <div class="grid g4">
    ${stat("Total book complete", o.pct + "%", `${o.done} of ${o.total} boxes`)}
    ${stat("Pages", S.pages.length, `${stages.done} approved • ${stages.first + stages.second + stages.editor + stages.final} in proofing`)}
    ${stat("Next benchmark", next ? (daysUntil(next.date) === 0 ? "Today" : daysUntil(next.date) + " days") : "—", next ? `${esc(next.set)} • ${next.label} • ${fmtDate(next.date)}` : "No upcoming dates set")}
    ${stat("Students", S.roster.length, `${S.pages.filter((p) => p.assignees.length).length} pages assigned`)}
  </div>
  <div class="card"><h2>Total Book Progress</h2><div class="row" style="border:0;padding:0 0 8px"><span>${o.done} / ${o.total} boxes</span><b>${o.pct}%</b></div>${bar(o.pct)}</div>
  <div class="grid g2">
    <div class="card"><h2>📅 Progress by Deadline</h2>
      <div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--line)"><div class="row" style="border:0;padding:0 0 6px"><span><b>Total book</b> <span class="muted small">${S.pages.length} pages</span></span><b>${o.pct}%</b></div>${bar(o.pct, "sm")}</div>
      ${sums.map((d) => `<div style="margin-bottom:14px"><div class="row" style="border:0;padding:0 0 6px"><span><b>${esc(d.name)}</b> <span class="muted small">${d.count} page${d.count === 1 ? "" : "s"}${d.due ? " • due " + fmtDate(d.due) : ""}</span> ${d.overdue ? '<span class="chip late">Overdue</span>' : ""}</span><b>${d.count ? d.pct + "%" : "—"}</b></div>${bar(d.pct, "sm")}</div>`).join("")}
      ${isAdv() && S.pages.some((p) => !p.deadline) ? `<p class="small muted" style="margin:0"><a href="#/assign">${S.pages.filter((p) => !p.deadline).length} pages</a> aren't on a deadline yet.</p>` : ""}</div>
    <div class="card"><h2>📊 Pages by Stage</h2>${Object.keys(stages).map((k) => `<div class="row"><span>${STAGE_LABEL[k]}</span><b>${stages[k]}</b></div>`).join("")}
      <h2 style="margin-top:20px">⚡ Quick Actions</h2><div class="actions"><a class="btn red" href="#/proof">Proof a page</a><a class="btn" href="#/pages">All pages</a><a class="btn" href="#/deadlines">Deadlines</a>${isAdv() ? '<a class="btn" href="#/assign">Assign pages</a>' : ""}</div></div>
  </div>
  ${showSpot ? `<div class="grid g2">
    <div class="card"><h2>🏆 Furthest Along</h2>${fa.length ? fa.map((r, i) => `<div class="row"><span>${i + 1}. ${esc(r.name)}</span><b>${r.avg}%</b></div>`).join("") : '<div class="empty">Assign pages to see progress here.</div>'}</div>
    <div class="card"><h2>🔍 Top Proofers</h2>${tp.length ? tp.map((r, i) => `<div class="row"><span>${i + 1}. ${esc(r.name)}</span><b>${r.total}</b></div>`).join("") : '<div class="empty">Finished proofs will show up here.</div>'}</div>
  </div>` : ""}
  ${!isAdv() ? `<div class="card"><h2>📄 My Pages</h2>${mine.length ? mine.map((p) => { const g = pageProgress(p, T()); return `<a class="row" style="text-decoration:none;color:inherit" href="#/page/${p.num}"><span>Page ${p.num} — ${esc(p.content)}</span><span>${stagePill(p)} <b>${g.pct}%</b></span></a>`; }).join("") : '<div class="empty">No pages assigned to you yet. Your advisor will add them.</div>'}</div>` : ""}`;
}

function viewPages() {
  const u = S.ui;
  let list = S.pages.filter((p) => {
    if (u.pagesFilter === "mine" && !p.assignees.includes(S.me.name)) return false;
    if (u.pagesFilter === "unassigned" && p.assignees.length) return false;
    if (["building", "first", "second", "editor", "final", "done"].includes(u.pagesFilter) && stage(p, T()) !== u.pagesFilter) return false;
    const q = u.pagesSearch.toLowerCase();
    return !q || p.content.toLowerCase().includes(q) || String(p.num) === q || p.assignees.some((a) => a.toLowerCase().includes(q));
  });
  return `<h1>Pages</h1><p class="sub">Open a page to see its sprint checklists.</p>
  <div class="toolbar"><input type="text" id="psearch" placeholder="Search page, topic, or student" value="${esc(u.pagesSearch)}">
    <select id="pfilter">${[["all", "All pages"], ["mine", "My pages"], ["unassigned", "Unassigned"], ...Object.entries(STAGE_LABEL)].map(([k, v]) => `<option value="${k}" ${u.pagesFilter === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
  <div class="card tablewrap"><table><thead><tr><th>Pg</th><th>Content</th><th>Deadline</th><th>Students</th><th style="width:22%">Progress</th><th>Stage</th></tr></thead><tbody>
  ${list.map((p) => { const g = pageProgress(p, T()); return `<tr class="click" data-go="page/${p.num}"><td><b>${p.num}</b></td><td>${esc(p.content)}</td><td>${setOf(p) ? esc(setOf(p).name) : '<span class="muted">—</span>'}</td><td>${p.assignees.map((a) => `<span class="chip">${esc(a)}</span>`).join("") || '<span class="muted">—</span>'}</td><td>${bar(g.pct, "sm")}<span class="small muted">${g.pct}%</span></td><td>${stagePill(p)}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">No pages match.</td></tr>`}
  </tbody></table></div>`;
}

function viewPage(n) {
  const p = pageBy(n);
  if (!p) return `<h1>Page not found</h1><p><a href="#/pages">Back to pages</a></p>`;
  const g = pageProgress(p, T()); const tasks = taskList(T()[p.template]); const edit = canEdit(p);
  const sp = S.ui.sprint;
  const ds = setOf(p); const dl = ds?.dates?.["s" + sp] || "";
  return `<p><a href="#/pages">← All pages</a></p><h1>Page ${p.num}: ${esc(p.content)}</h1>
  <p class="sub">${p.assignees.map((a) => `<span class="chip">${esc(a)}</span>`).join("") || "No students assigned yet"} ${stagePill(p)}</p>
  <div class="card"><div class="row" style="border:0;padding:0 0 8px"><span>Overall (${g.allDone}/${g.allTotal} boxes, includes proofs)</span><b>${g.pct}%</b></div>${bar(g.pct)}
    ${!edit ? '<p class="muted small" style="margin:12px 0 0">You can view this page, but only the assigned students can check boxes.</p>' : ""}</div>
  <div class="seg">${[1, 2, 3].map((s) => `<button data-sprint="${s}" class="${sp === s ? "on" : ""}">Sprint ${s} • ${g.bySprint[s].done}/${g.bySprint[s].total}</button>`).join("")}</div>
  <div class="card"><div class="row" style="border:0;padding:0 0 10px"><span class="muted">${ds ? esc(ds.name) + (dl ? " • due " + fmtDate(dl) : " • no date set") : "No deadline assigned yet"}${dl && isOverdue(dl) && g.bySprint[sp].done < g.bySprint[sp].total ? ' <span class="chip late">Overdue</span>' : ""}</span><b>${g.bySprint[sp].done}/${g.bySprint[sp].total} completed</b></div>
  ${CATS.map((c) => {
    const items = tasks.filter((t) => t.sprint === sp && t.cat === c); if (!items.length) return "";
    const all = items.every((t) => p.checks[t.key]);
    return `<div class="cat"><h3>${CAT_LABEL[c]} ${all ? '<span class="tick">✓</span>' : ""}</h3>${items.map((t) => `<label class="${edit ? "" : "ro"}"><input type="checkbox" data-check="${t.key}" ${p.checks[t.key] ? "checked" : ""} ${edit ? "" : "disabled"}> <span>${esc(t.text)}</span></label>`).join("")}</div>`;
  }).join("")}</div>
  ${g.ready ? `<div class="card"><h2>🔍 Proofing</h2>${STEPS.map((s) => { const r = p.proof[s] || {}; return `<div class="row"><span>${STEP_LABEL[s]}</span><span>${r.fixed ? `<span class="chip done">${r.noEdits ? "No edits needed" : "Edits made"} • ${esc(r.proofer)}</span>` : r.proofer ? `<span class="chip prog">${esc(r.proofer)} is proofing</span>` : '<span class="muted">Waiting</span>'}</span></div>`; }).join("")}<p class="small muted" style="margin-bottom:0">Go to <a href="#/proof">Pages to Proof</a> to claim or fix edits.</p></div>` : ""}`;
}

// ----- assign -----
function viewAssign() {
  const a = S.ui.assign;
  const groups = [...new Set(S.pages.map((p) => p.content))];
  const unassigned = S.pages.filter((p) => !p.assignees.length).length;
  const noDl = S.pages.filter((p) => !p.deadline).length;
  const load = S.roster.map((r) => ({ name: r.name, n: S.pages.filter((p) => p.assignees.includes(r.name)).length }));
  const list = S.pages.filter((p) => {
    if (a.unassigned && p.assignees.length) return false;
    if (a.student && !p.assignees.includes(a.student)) return false;
    if (a.group && p.content !== a.group) return false;
    if (a.dl === "none" && p.deadline) return false;
    if (a.dl && a.dl !== "none" && p.deadline !== +a.dl) return false;
    const q = a.filter.toLowerCase();
    return !q || p.content.toLowerCase().includes(q) || String(p.num) === q;
  });
  const dlopts = (sel) => `<option value="">— none —</option>` + sets().map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const opts = (sel) => `<option value="">— none —</option>` + S.roster.map((r) => `<option ${r.name === sel ? "selected" : ""}>${esc(r.name)}</option>`).join("");
  return `<h1>Assign Pages</h1><p class="sub">Give each page up to 3 students and a deadline. Changes save as you pick.</p>
  ${unassigned ? `<div class="banner"><b>${unassigned}</b> of ${S.pages.length} pages have no students.${noDl ? ` <b>${noDl}</b> have no deadline.` : ""}</div>` : '<div class="banner" style="background:#e9f7ee;border-color:#bde5c9;color:#14532d">Every page has at least one student. 🎉${noDl ? ` <b>${noDl}</b> pages still need a deadline.` : ""}</div>'}
  <div class="assign"><div>
    <div class="bulk"><h2 style="margin-bottom:10px">Bulk assign</h2>
      <div class="cols">
        <div><label class="small muted">Pages (${a.sel.size} selected)</label><input type="text" id="brange" placeholder="e.g. 8-15, 20, 22"></div>
        <div><label class="small muted">Or a whole group</label><select id="bgroup"><option value="">Choose group…</option>${groups.map((g) => `<option>${esc(g)}</option>`).join("")}</select></div>
        <div><label class="small muted">Action</label><select id="bmode"><option value="add">Add students</option><option value="replace">Replace with</option><option value="remove">Remove students</option><option value="clear">Clear all students</option></select></div>
        <div style="align-self:end"><button class="btn red" id="bapply" style="width:100%">Apply</button></div>
      </div>
      <div style="margin-top:12px"><label class="small muted">Students (up to 3)</label><div class="studentpick">${S.roster.map((r) => `<label><input type="checkbox" class="bstud" value="${esc(r.name)}"> ${esc(r.name)}</label>`).join("")}</div></div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;align-items:end"><div style="flex:1;min-width:200px"><label class="small muted">Deadline for the same pages</label><select id="bdl"><option value="">Choose a deadline…</option>${sets().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}<option value="none">No deadline</option></select></div><button class="btn red" id="bdlapply">Set deadline</button></div>
      <p class="small muted" style="margin:10px 0 0">Tick rows in the table too — selected rows are included with the range and group.</p></div>
    <div class="toolbar"><input type="text" id="afilter" placeholder="Search page or topic" value="${esc(a.filter)}">
      <select id="astudent"><option value="">All students</option>${S.roster.map((r) => `<option ${a.student === r.name ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
      <select id="agroup"><option value="">All groups</option>${groups.map((g) => `<option ${a.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
      <select id="adlf"><option value="">All deadlines</option>${sets().map((s) => `<option value="${s.id}" ${a.dl === String(s.id) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="none" ${a.dl === "none" ? "selected" : ""}>No deadline</option></select>
      <label style="display:flex;gap:8px;align-items:center;flex:none"><input type="checkbox" id="aun" ${a.unassigned ? "checked" : ""}> Unassigned only</label></div>
    <div class="card tablewrap" style="padding:8px"><table><thead><tr><th><input type="checkbox" id="aall" aria-label="Select all shown"></th><th>Pg</th><th>Content</th><th>Deadline</th><th>Student 1</th><th>Student 2</th><th>Student 3</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td><input type="checkbox" class="arow" value="${p.num}" ${a.sel.has(p.num) ? "checked" : ""}></td><td><b>${p.num}</b></td><td>${esc(p.content)}</td><td><select class="adl" data-page="${p.num}" aria-label="Deadline for page ${p.num}">${dlopts(p.deadline)}</select></td>${[0, 1, 2].map((i) => `<td><select class="aslot" data-page="${p.num}" data-slot="${i}" aria-label="Student ${i + 1} for page ${p.num}">${opts(p.assignees[i])}</select></td>`).join("")}</tr>`).join("") || '<tr><td colspan="7" class="empty">No pages match.</td></tr>'}
    </tbody></table></div></div>
    <div><div class="card"><h2>Pages per deadline</h2>${sets().map((s) => `<div class="row"><span>${esc(s.name)}</span><b>${S.pages.filter((p) => p.deadline === s.id).length}</b></div>`).join("")}<div class="row"><span>No deadline</span><b class="${noDl ? "zero" : ""}">${noDl}</b></div></div>
    <div class="card workload"><h2>Workload</h2><p class="small muted">Pages per student</p>${load.sort((x, y) => x.n - y.n || x.name.localeCompare(y.name)).map((l) => `<div class="row"><span>${esc(l.name)}</span><b class="${l.n === 0 ? "zero" : ""}">${l.n}</b></div>`).join("")}</div></div></div>`;
}
function parseRange(str) {
  const out = new Set();
  for (const part of str.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); } else if (/^\d+$/.test(part)) out.add(+part);
  }
  return out;
}
async function applySetDeadline(pages, deadline) {
  const d = await api("setdeadline", { pages, deadline });
  if (!d) return;
  S.pages = d.pages; toast(`Updated ${pages.length} page(s).`); render();
}
function bulkPages() {
  const pages = new Set(S.ui.assign.sel);
  parseRange($("#brange").value).forEach((n) => pages.add(n));
  const g = $("#bgroup").value; if (g) S.pages.filter((p) => p.content === g).forEach((p) => pages.add(p.num));
  return pages;
}
async function applyAssign(pages, mode, students) {
  const d = await api("assign", { pages, mode, students });
  if (!d) return;
  S.pages = d.pages;
  const errs = d.results.filter((r) => r.error);
  toast(errs.length ? `${errs.length} page(s) skipped: ${errs[0].error}` : `Updated ${d.results.length} page(s).`, !!errs.length);
  render();
}

// ----- page requests -----
const awardIcons = (r) => (r?.awards || []).map((a) => `<span title="${esc(a.label)}">${a.icon}</span>`).join(" ");
function viewRequests() {
  const board = priorityBoard(S.pages, S.roster, T());
  const by = new Map(board.map((r) => [r.name, r]));
  const reviewer = isReviewer();
  const tab = !reviewer ? "request" : isAdv() ? "review" : S.ui.reqTab;
  const open = S.settings.requestsOpen !== false, limit = S.settings.requestLimit ?? 5;
  const f = S.ui.req;
  const groups = [...new Set(S.pages.map((p) => p.content))];
  const meRow = isAdv() ? null : by.get(S.me.name);
  const myPending = isAdv() ? [] : S.pages.filter((p) => pendingReqs(p).some((r) => r.name === S.me.name));
  const showBoard = reviewer || S.settings.spotlight;

  const boardCard = `<div class="card"><h2>🏆 Priority Board</h2>
    <p class="small muted">Priority points = average % complete of your pages + ${PRIORITY.proofPoints} for every proof you finish. Higher points get first pick.</p>
    ${meRow ? `<div class="row" style="background:#fff7f8;border-radius:10px;padding:10px"><span><b>You</b> ${awardIcons(meRow)}<br><span class="small muted">Rank ${meRow.rank} of ${board.length} • ${meRow.pages} page${meRow.pages === 1 ? "" : "s"} • ${meRow.proofs} proof${meRow.proofs === 1 ? "" : "s"}</span></span><b>${meRow.points}</b></div>` : ""}
    ${showBoard ? board.filter((r) => r.points > 0).slice(0, 12).map((r) => `<div class="row"><span><span class="medal">${r.rank}.</span>${esc(r.name)} ${awardIcons(r)}</span><b>${r.points}</b></div>`).join("") || '<div class="empty">Points show up as pages get finished and proofed.</div>' : ""}
    <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Award legend</summary>${AWARD_LEGEND.map(([i, t]) => `<div class="small" style="padding:4px 0">${i} ${esc(t)}</div>`).join("")}</details></div>`;

  let main = "";
  if (tab === "request") {
    const q = f.search.toLowerCase();
    const rows = S.pages.filter((p) => !p.assignees.includes(S.me.name) && (!f.group || p.content === f.group) && (!q || p.content.toLowerCase().includes(q) || String(p.num) === q));
    main = `<div class="banner" style="background:${open ? "#eef4ff" : "#fff7e6"}">${open ? `Requests are <b>open</b>. You've used <b>${myPending.length} of ${limit}</b> requests.` : "Requests are <b>closed</b> right now. Your advisor will open them again."} Your advisor and editors review requests, with priority going to students with the most points.</div>
      <div class="toolbar"><input type="text" id="rsearch" placeholder="Search page number or topic" value="${esc(f.search)}"><select id="rgroup"><option value="">All groups</option>${groups.map((g) => `<option ${f.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
      <div class="card tablewrap" style="padding:8px"><table><thead><tr><th>Pg</th><th>Content</th><th>Students now</th><th>Requests</th><th></th></tr></thead><tbody>
      ${rows.map((p) => { const mine = (p.requests || []).find((r) => r.name === S.me.name); const cnt = p.requestCount ?? pendingReqs(p).length; const full = p.assignees.length >= 3;
        const act = mine ? (mine.status === "declined" ? '<span class="chip">Not assigned this time</span>' : `<span class="chip prog">Requested</span> <button class="btn sm" data-req="remove" data-page="${p.num}">Withdraw</button>`)
          : full ? '<span class="chip">Page full</span>' : `<button class="btn red sm" data-req="add" data-page="${p.num}" ${open && myPending.length < limit ? "" : "disabled"}>Request</button>`;
        return `<tr><td><b>${p.num}</b></td><td>${esc(p.content)}</td><td>${p.assignees.map((a) => `<span class="chip">${esc(a)}</span>`).join("") || '<span class="muted">Open</span>'} <span class="small muted">${p.assignees.length}/3</span></td><td>${cnt || '<span class="muted">0</span>'}</td><td>${act}</td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">No pages match.</td></tr>'}
      </tbody></table></div>`;
  } else {
    const reqPages = S.pages.filter((p) => (p.requests || []).length && (!f.group || p.content === f.group) && (!f.student || p.requests.some((r) => r.name === f.student)));
    main = `<div class="banner" style="background:${open ? "#eef4ff" : "#fff7e6"}">Requests are <b>${open ? "open" : "closed"}</b>. ${isAdv() ? 'Change this in <a href="#/admin">Admin</a>.' : ""} Students are listed highest points first. ${isAdv() ? "" : "Editors can't review their own requests."}</div>
      <div class="toolbar"><select id="rstud"><option value="">All requesting students</option>${S.roster.map((r) => `<option ${f.student === r.name ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select><select id="rgroup"><option value="">All groups</option>${groups.map((g) => `<option ${f.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
      ${reqPages.map((p) => { const full = p.assignees.length >= 3;
        const rs = [...p.requests].sort((a, b) => (by.get(b.name)?.points || 0) - (by.get(a.name)?.points || 0) || a.at - b.at);
        return `<div class="proofcard"><header><div><b>Page ${p.num}</b> — ${esc(p.content)} ${setOf(p) ? `<span class="chip">${esc(setOf(p).name)}</span>` : ""}<br>${p.assignees.map((a) => `<span class="chip">${esc(a)}</span>`).join("")}<span class="small muted"> ${p.assignees.length}/3 students</span></div>${full ? '<span class="chip late">Page full</span>' : ""}</header>
        ${rs.map((r) => { const s = by.get(r.name); const declined = r.status === "declined"; const self = !isAdv() && r.name === S.me.name;
          return `<div class="row"><span><b>${esc(r.name)}</b> ${awardIcons(s)} ${declined ? '<span class="chip">Declined</span>' : ""}<br><span class="small muted">${s?.points || 0} pts • ${s?.avg || 0}% complete • ${s?.proofs || 0} proofs • ${s?.pages || 0} page${s?.pages === 1 ? "" : "s"} assigned</span></span>
          <span>${self ? '<span class="small muted">Review by someone else</span>' : `<button class="btn red sm" data-grant="assign" data-page="${p.num}" data-student="${esc(r.name)}" ${full ? "disabled" : ""}>Assign</button> ${declined ? "" : `<button class="btn sm" data-grant="decline" data-page="${p.num}" data-student="${esc(r.name)}">Decline</button>`}`}</span></div>`; }).join("")}</div>`; }).join("") || '<div class="card empty">No page requests yet.</div>'}`;
  }
  const tabs = reviewer && !isAdv() ? `<div class="seg"><button data-rtab="request" class="${tab === "request" ? "on" : ""}">Request pages</button><button data-rtab="review" class="${tab === "review" ? "on" : ""}">Review requests (${S.pages.reduce((n, p) => n + pendingReqs(p).length, 0)})</button></div>` : "";
  return `<h1>Page Requests</h1><p class="sub">${tab === "request" ? "Choose the pages you'd like to work on." : "Pick students from the request list and assign them pages."}</p>${tabs}
  <div class="assign"><div>${main}</div><div>${boardCard}</div></div>`;
}

// ----- proof -----
function proofCard(p, step) {
  const rec = p.proof[step] || {}; const me = S.me.name;
  const isAssignee = p.assignees.includes(me), isProofer = rec.proofer === me;
  const meR = S.roster.find((r) => r.name === me);
  const earlier = STEPS.slice(0, STEPS.indexOf(step)).map((s) => p.proof[s]?.proofer);
  let actions = "";
  if (!rec.proofer) {
    if (isAdv()) actions = '<span class="muted small">Waiting for a student to claim</span>';
    else if (isAssignee) actions = '<span class="muted small">This is your page, so someone else will proof it.</span>';
    else if (earlier.includes(me) && !meR?.editor) actions = '<span class="muted small">You proofed this page in an earlier step.</span>';
    else if (step === "editor" && !meR?.editor) actions = '<span class="muted small">Editors only</span>';
    else actions = `<button class="btn red sm" data-proof="claim" data-page="${p.num}" data-step="${step}">Proof this page</button>`;
  } else {
    if (isProofer || isAdv()) actions += `<button class="btn sm" data-proof="nopass" data-page="${p.num}" data-step="${step}">No edits needed</button> <button class="btn sm" data-proof="release" data-page="${p.num}" data-step="${step}">Release page</button> `;
    if (isAssignee || isAdv()) actions += `<button class="btn red sm" data-proof="fixed" data-page="${p.num}" data-step="${step}">Edits made</button> `;
    if (isAdv()) actions += `<button class="btn sm" data-proof="reset" data-page="${p.num}" data-step="${step}">Reset step</button>`;
  }
  return `<div class="proofcard"><header><div><b>Page ${p.num}</b> — ${esc(p.content)}<br>${p.assignees.map((a) => `<span class="chip">${esc(a)}</span>`).join("")}</div>
    <div>${rec.proofer ? `<span class="chip prog">Proofer: ${esc(rec.proofer)}</span>` : '<span class="chip">Open</span>'}</div></header>
    ${rec.proofer ? (isProofer && !rec.fixed ? `<textarea data-notes="${p.num}" data-step="${step}" placeholder="List the edits the designer should make…">${esc(rec.notes)}</textarea><button class="btn sm" data-savenotes="${p.num}" data-step="${step}">Save notes</button>` : `<div class="notes">${rec.notes ? esc(rec.notes) : '<span class="muted">No notes yet.</span>'}</div>${isAssignee ? '<div class="small muted">Make the edits, then click “Edits made.”</div>' : ""}`) : ""}
    <div class="actions" style="margin-top:10px">${actions}</div></div>`;
}
function viewProof() {
  const tab = S.ui.proofTab; const me = S.me.name;
  const building = S.pages.filter((p) => stage(p, T()) === "building" && pageProgress(p, T()).total).length;
  const by = (s) => S.pages.filter((p) => stage(p, T()) === s);
  const tabs = [...STEPS, ...(isAdv() ? ["final"] : [])];
  const mineClaimed = STEPS.flatMap((s) => S.pages.filter((p) => p.proof[s]?.proofer === me && !p.proof[s].fixed).map((p) => ({ p, s })));
  const fixes = STEPS.flatMap((s) => S.pages.filter((p) => p.assignees.includes(me) && p.proof[s]?.proofer && !p.proof[s].fixed).map((p) => ({ p, s })));
  let body = "";
  if (tab === "final") {
    body = by("final").map((p) => `<div class="proofcard"><header><div><b>Page ${p.num}</b> — ${esc(p.content)}</div><button class="btn red sm" data-final="${p.num}">Approve page</button></header></div>`).join("") || '<div class="empty">No pages waiting for approval.</div>';
    body += S.pages.filter((p) => p.final?.approved).map((p) => `<div class="proofcard"><b>Page ${p.num}</b> — ${esc(p.content)} <span class="chip done">Approved</span> <button class="btn sm" data-unapprove="${p.num}">Undo</button></div>`).join("");
  } else {
    body = by(tab).map((p) => proofCard(p, tab)).join("") || `<div class="empty">No pages in ${STEP_LABEL[tab]} yet. Pages show up here once every sprint box is checked${tab !== "first" ? " and the earlier proof is done" : ""}.</div>`;
  }
  return `<h1>Pages to Proof</h1><p class="sub">${building} pages are still being built. A page appears here when all its boxes are checked.</p>
  ${fixes.length ? `<div class="banner"><b>Edits to fix on your pages:</b> ${fixes.map(({ p, s }) => `Page ${p.num} (${STEP_LABEL[s]})`).join(", ")}</div>` : ""}
  ${mineClaimed.length ? `<div class="banner" style="background:#eef4ff;border-color:#c7d8fb;color:#1e3a8a"><b>You're proofing:</b> ${mineClaimed.map(({ p, s }) => `Page ${p.num} (${STEP_LABEL[s]})`).join(", ")}</div>` : ""}
  <div class="seg">${tabs.map((s) => `<button data-ptab="${s}" class="${tab === s ? "on" : ""}">${s === "final" ? "Final approval" : STEP_LABEL[s]} (${by(s).length})</button>`).join("")}</div>${body}`;
}

// ----- spotlight -----
function viewSpotlight() {
  if (!S.settings.spotlight && !isAdv()) return `<h1>Spotlight</h1><div class="card empty">The Spotlight is hidden right now.</div>`;
  const tab = S.ui.lbTab;
  const fa = furthestAlong(S.pages, S.roster, T()), tp = topProofers(S.pages, S.roster);
  const rows = tab === "progress"
    ? fa.map((r, i) => `<div class="row"><span><span class="medal">${medal(i)}</span><b>${esc(r.name)}</b> <span class="muted small">${r.finished} of ${r.pages} page${r.pages === 1 ? "" : "s"} ready to proof</span></span><b>${r.avg}%</b></div>`)
    : tp.map((r, i) => `<div class="row"><span><span class="medal">${medal(i)}</span><b>${esc(r.name)}</b> <span class="muted small">First ${r.first} • Second ${r.second} • Editor ${r.editor}</span></span><b>${r.total} proofs</b></div>`);
  return `<h1>Spotlight</h1><p class="sub">${isAdv() ? "Students see this page only while the Spotlight is turned on in Admin." : "Shout-outs for the students making the most progress."}</p>
  <div class="seg"><button data-lb="progress" class="${tab === "progress" ? "on" : ""}">Furthest along</button><button data-lb="proof" class="${tab === "proof" ? "on" : ""}">Most proofs</button></div>
  <div class="card">${rows.join("") || '<div class="empty">Nothing to show yet.</div>'}</div>`;
}

// ----- deadlines -----
function viewDeadlines() {
  const f = S.ui.dl;
  const sums = sets().map((s) => deadlineSummary(S.pages, T(), s));
  const noDl = S.pages.filter((p) => !p.deadline && pageProgress(p, T()).total).length;
  const row = (d, k) => { const b = d.bench[k]; const unit = k[0] === "s" ? "tasks" : "pages";
    return `<div style="margin-bottom:14px"><div class="row" style="border:0;padding:0 0 6px"><span><b>${BENCH_LABEL[k]}</b> <span class="muted small">${when(b.date)}</span> ${b.overdue ? '<span class="chip late">Overdue</span>' : ""}</span><span><span class="muted small">${b.done}/${b.total} ${unit}</span> &nbsp;<b>${b.total ? b.pct + "%" : "—"}</b></span></div>${bar(b.pct, "sm " + (b.pct >= 100 ? "green" : ""))}</div>`; };
  return `<h1>Deadlines</h1><p class="sub">Three deadlines. Each has its own pages, three sprint benchmarks, and three proof steps.</p>
  ${isAdv() && noDl ? `<div class="banner"><b>${noDl} pages</b> aren't on a deadline yet, so they aren't counted below. <a href="#/assign">Assign deadlines →</a></div>` : ""}
  <div class="toolbar"><select id="dlstudent"><option value="">All students' pages</option>${S.roster.map((r) => `<option ${f.student === r.name ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
  <label style="display:flex;gap:8px;align-items:center;flex:none"><input type="checkbox" id="dlover" ${f.overdue ? "checked" : ""}> Overdue pages only</label></div>
  ${sums.map((d) => {
    let items = d.pages.map((p) => { const g = pageProgress(p, T()); const st = stage(p, T());
      return { p, cls: st === "done" || st === "final" ? "done" : d.overdue ? "late" : g.pct > 0 ? "prog" : "" }; });
    if (f.student) items = items.filter((i) => i.p.assignees.includes(f.student));
    if (f.overdue) items = items.filter((i) => i.cls === "late");
    return `<div class="card"><div class="row" style="border:0;padding:0 0 10px"><div><h2 style="margin:0">${esc(d.name)} ${d.overdue ? '<span class="chip late">Overdue</span>' : ""}</h2>
      <span class="muted">${d.count} page${d.count === 1 ? "" : "s"}${d.count ? " (" + ranges(d.pages.map((p) => p.num)) + ")" : ""} • due ${fmtDate(d.due)}</span></div><b style="font-size:30px">${d.count ? d.pct + "%" : "—"}</b></div>
      ${d.count ? bar(d.pct, d.pct >= 100 ? "green" : "") + `<p class="small muted" style="margin:6px 0 0">${d.done} of ${d.total} boxes, including proofs</p>
      <div class="grid g2" style="margin-top:20px"><div><h3 style="margin:0 0 12px;font-size:15px">Sprints</h3>${["s1", "s2", "s3"].map((k) => row(d, k)).join("")}</div>
      <div><h3 style="margin:0 0 12px;font-size:15px">Proofs</h3>${["first", "second", "editor"].map((k) => row(d, k)).join("")}</div></div>
      <p class="small muted" style="margin:6px 0">Pages <span class="chip done">approved or ready for approval</span><span class="chip prog">in progress</span><span class="chip late">overdue</span></p>
      <div>${items.map((i) => `<a class="chip link ${i.cls}" href="#/page/${i.p.num}" title="${esc(i.p.content)}">${i.p.num}</a>`).join("") || '<span class="muted">Nothing to show.</span>'}</div>`
      : `<div class="empty">No pages are assigned to this deadline yet.${isAdv() ? ' <a href="#/assign">Assign pages →</a>' : ""}</div>`}</div>`;
  }).join("")}`;
}

// ----- admin -----
function viewAdmin() {
  return `<h1>Admin</h1><p class="sub">Deadline dates, roster, and page setup.</p>
  <div class="card"><h2>Deadlines</h2><p class="small muted">Each deadline has three sprint benchmarks and three proof dates. Leave a date blank if you haven't picked it yet. Assign pages to a deadline on the Assign Pages tab.</p>
    ${sets().map((s, i) => `<div class="bulk"><label class="small muted" for="dn${i}">Deadline name</label><input type="text" id="dn${i}" data-dname="${i}" value="${esc(s.name)}" style="max-width:280px;margin-bottom:12px">
      <div class="grid g3" style="margin-bottom:0">${BENCH.map((k) => `<div><label class="small muted">${BENCH_LABEL[k]}</label><input type="date" data-ddate="${i}:${k}" value="${s.dates?.[k] || ""}"></div>`).join("")}</div></div>`).join("")}
    <button class="btn red" id="savedl">Save deadlines</button></div>
  <div class="card"><h2>Spotlight</h2><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="spot" ${S.settings.spotlight ? "checked" : ""}> Show Spotlight and top-5 lists to students</label></div>
  <div class="card"><h2>Page Requests</h2><label style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><input type="checkbox" id="reqopen" ${S.settings.requestsOpen !== false ? "checked" : ""}> Students can request pages right now</label>
    <label class="small muted" for="reqlimit">Most pages one student can request at a time</label><input type="number" id="reqlimit" min="1" max="20" value="${S.settings.requestLimit ?? 5}" style="max-width:120px;margin-bottom:12px"><br><button class="btn red" id="savereq">Save request settings</button></div>
  <div class="card"><h2>Import from the old site</h2><p class="small muted">Replaces the roster, settings, and matching pages with the old site's data. Skip this if you're starting fresh.</p>${importHelp()}</div>
  <div class="card"><h2>Roster</h2><p class="small muted">Check “Editor” for students allowed to do the Editor Proof. Removing a student also removes them from any pages.</p>
    <div class="tablewrap"><table><tbody>${S.roster.map((r, i) => `<tr><td>${esc(r.name)}</td><td><label><input type="checkbox" data-editor="${i}" ${r.editor ? "checked" : ""}> Editor</label></td><td><button class="btn sm" data-rmstud="${i}">Remove</button></td></tr>`).join("")}</tbody></table></div>
    <div class="toolbar" style="margin-top:12px"><input type="text" id="newstud" placeholder="First name + last initial (e.g. Sam R)"><button class="btn red" id="addstud">Add student</button></div></div>
  <div class="card"><h2>Pages</h2><div class="toolbar"><input type="number" id="npnum" placeholder="Page #"><input type="text" id="npname" placeholder="Content name"><select id="nptpl">${Object.entries(T()).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select><button class="btn red" id="addpage">Add page</button></div>
    <div class="tablewrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>Pg</th><th>Content</th><th>Checklist</th><th></th></tr></thead><tbody>${S.pages.map((p) => `<tr><td><b>${p.num}</b></td><td><input type="text" data-pname="${p.num}" value="${esc(p.content)}"></td><td><select data-ptpl="${p.num}">${Object.entries(T()).map(([k, t]) => `<option value="${k}" ${p.template === k ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></td><td><button class="btn sm" data-delpage="${p.num}">Delete</button></td></tr>`).join("")}</tbody></table></div></div>`;
}
function importHelp() {
  return `<p class="muted">On the old site, sign in as advisor, open the browser console (Ctrl+Shift+J), and paste this line. It copies all your data:</p>
  <textarea readonly style="min-height:90px;font-family:monospace;font-size:13px" onclick="this.select()">copy(JSON.stringify(await (await fetch("/api/state",{headers:{"x-advisor":JSON.parse(localStorage.getItem("yh-creds")).advisor}})).json()))</textarea>
  <p class="muted">Then paste it here (Ctrl+V) and click Import.</p>
  <textarea id="importtext" placeholder="Paste the copied data here"></textarea><div style="margin-top:10px"><button class="btn red" id="doimport">Import data</button></div>`;
}
async function admin(body) {
  const d = await api("admin", body);
  if (!d) return false;
  Object.assign(S, { settings: d.settings, roster: d.roster, pages: d.pages });
  return true;
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const el = (a) => e.target.closest(`[${a}]`);
  let t;
  if ((t = el("data-go"))) { location.hash = "#/" + t.dataset.go; return; }
  if ((t = el("data-sprint"))) { S.ui.sprint = +t.dataset.sprint; render(); return; }
  if ((t = el("data-ptab"))) { S.ui.proofTab = t.dataset.ptab; render(); return; }
  if ((t = el("data-lb"))) { S.ui.lbTab = t.dataset.lb; render(); return; }
  if ((t = el("data-proof"))) {
    if (t.dataset.proof === "reset" && !confirm("Reset this step and every step after it?")) return;
    const d = await api("proof", { page: +t.dataset.page, step: t.dataset.step, action: t.dataset.proof });
    if (d) { mergePage(d.page); render(); } return;
  }
  if ((t = el("data-savenotes"))) {
    const ta = document.querySelector(`textarea[data-notes="${t.dataset.savenotes}"][data-step="${t.dataset.step}"]`);
    const d = await api("proof", { page: +t.dataset.savenotes, step: t.dataset.step, action: "notes", notes: ta.value });
    if (d) { mergePage(d.page); toast("Notes saved."); } return;
  }
  if ((t = el("data-final"))) { const d = await api("final", { page: +t.dataset.final, approve: true }); if (d) { mergePage(d.page); render(); } return; }
  if ((t = el("data-unapprove"))) { const d = await api("final", { page: +t.dataset.unapprove, approve: false }); if (d) { mergePage(d.page); render(); } return; }
  if ((t = el("data-rtab"))) { S.ui.reqTab = t.dataset.rtab; render(); return; }
  if ((t = el("data-req"))) { const d = await api("request", { page: +t.dataset.page, action: t.dataset.req }); if (d) { mergePage(d.page); render(); } return; }
  if ((t = el("data-grant"))) {
    const d = await api("grant", { page: +t.dataset.page, student: t.dataset.student, action: t.dataset.grant });
    if (d) { mergePage(d.page); toast(t.dataset.grant === "assign" ? `${t.dataset.student} assigned to page ${t.dataset.page}.` : "Request declined."); render(); } return;
  }
  if (e.target.id === "doimport") {
    const txt = $("#importtext").value.trim(); if (!txt) return toast("Paste the copied data first.", true);
    let data; try { data = JSON.parse(txt); } catch { return toast("That doesn't look like the copied data. Try copying it again.", true); }
    if (!confirm("Import this data into your site?")) return;
    if (await admin({ action: "import", data })) { toast("Data imported."); S.version = undefined; render(); } return;
  }
  if (e.target.id === "savereq") { if (await admin({ action: "setRequestOptions", open: $("#reqopen").checked, limit: $("#reqlimit").value })) toast("Request settings saved."); return; }
  if (e.target.id === "bapply") {
    const pages = bulkPages();
    const students = [...document.querySelectorAll(".bstud:checked")].map((c) => c.value);
    const mode = $("#bmode").value;
    if (!pages.size) return toast("Pick pages first: tick rows, type a range, or choose a group.", true);
    if (mode !== "clear" && !students.length) return toast("Pick at least one student.", true);
    if (students.length > 3) return toast("Choose up to 3 students.", true);
    if (mode === "clear" && !confirm(`Clear all students from ${pages.size} page(s)?`)) return;
    S.ui.assign.sel.clear(); await applyAssign([...pages], mode, students); return;
  }
  if (e.target.id === "bdlapply") {
    const pages = bulkPages(); const v = $("#bdl").value;
    if (!pages.size) return toast("Pick pages first: tick rows, type a range, or choose a group.", true);
    if (!v) return toast("Choose a deadline first.", true);
    S.ui.assign.sel.clear(); await applySetDeadline([...pages], v === "none" ? null : +v); return;
  }
  if (e.target.id === "savedl") {
    const ds = sets().map((s, i) => ({ name: document.querySelector(`[data-dname="${i}"]`).value, dates: Object.fromEntries(BENCH.map((k) => [k, document.querySelector(`[data-ddate="${i}:${k}"]`).value])) }));
    if (await admin({ action: "saveDeadlines", deadlineSets: ds })) { toast("Deadlines saved."); render(); } return;
  }
  if (e.target.id === "addstud") { const n = $("#newstud").value.trim(); if (!n) return; if (await admin({ action: "saveRoster", roster: [...S.roster, { name: n, editor: false }] })) render(); return; }
  if ((t = el("data-rmstud"))) { const r = S.roster[+t.dataset.rmstud]; if (!confirm(`Remove ${r.name}? They'll be unassigned from their pages.`)) return; if (await admin({ action: "saveRoster", roster: S.roster.filter((_, i) => i !== +t.dataset.rmstud) })) render(); return; }
  if (e.target.id === "addpage") { if (await admin({ action: "addPage", num: $("#npnum").value, content: $("#npname").value, template: $("#nptpl").value })) render(); return; }
  if ((t = el("data-delpage"))) { if (!confirm(`Delete page ${t.dataset.delpage}? This can't be undone.`)) return; if (await admin({ action: "deletePage", num: +t.dataset.delpage })) render(); return; }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.check) {
    const num = +S.route.split("/")[1];
    const p = pageBy(num); const was = !!p.checks[t.dataset.check];
    if (t.checked) p.checks[t.dataset.check] = true; else delete p.checks[t.dataset.check];
    const d = await api("check", { page: num, key: t.dataset.check, value: t.checked });
    if (d) mergePage(d.page); else { if (was) p.checks[t.dataset.check] = true; else delete p.checks[t.dataset.check]; }
    render(); return;
  }
  if (t.classList.contains("aslot")) {
    const p = pageBy(t.dataset.page); const list = [...p.assignees]; const slot = +t.dataset.slot;
    const slots = [0, 1, 2].map((i) => document.querySelector(`.aslot[data-page="${p.num}"][data-slot="${i}"]`).value).filter(Boolean);
    if (new Set(slots).size !== slots.length) { toast("A student can only be on a page once.", true); render(); return; }
    await applyAssign([p.num], "replace", slots); return;
  }
  if (t.id === "rgroup") { S.ui.req.group = t.value; render(); return; }
  if (t.id === "rstud") { S.ui.req.student = t.value; render(); return; }
  if (t.classList.contains("adl")) { await applySetDeadline([+t.dataset.page], t.value ? +t.value : null); return; }
  if (t.id === "adlf") { S.ui.assign.dl = t.value; render(); return; }
  if (t.classList.contains("arow")) { t.checked ? S.ui.assign.sel.add(+t.value) : S.ui.assign.sel.delete(+t.value); return; }
  if (t.id === "aall") { document.querySelectorAll(".arow").forEach((c) => { c.checked = t.checked; t.checked ? S.ui.assign.sel.add(+c.value) : S.ui.assign.sel.delete(+c.value); }); return; }
  if (t.id === "astudent") { S.ui.assign.student = t.value; render(); } else if (t.id === "agroup") { S.ui.assign.group = t.value; render(); } else if (t.id === "aun") { S.ui.assign.unassigned = t.checked; render(); }
  else if (t.id === "pfilter") { S.ui.pagesFilter = t.value; render(); }
  else if (t.id === "dlstudent") { S.ui.dl.student = t.value; render(); } else if (t.id === "dlover") { S.ui.dl.overdue = t.checked; render(); }
  else if (t.id === "spot") { if (await admin({ action: "setSpotlight", value: t.checked })) toast("Saved."); }
  else if (t.dataset.editor !== undefined) { const r = S.roster.map((x, i) => (i === +t.dataset.editor ? { ...x, editor: t.checked } : x)); if (await admin({ action: "saveRoster", roster: r })) toast("Saved."); }
  else if (t.dataset.ptpl) { if (await admin({ action: "updatePage", num: +t.dataset.ptpl, template: t.value })) toast("Checklist updated."); }
  else if (t.dataset.pname) { if (await admin({ action: "updatePage", num: +t.dataset.pname, content: t.value })) toast("Saved."); }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "psearch") { S.ui.pagesSearch = t.value; const pos = t.selectionStart; render(); const n = $("#psearch"); n.focus(); n.setSelectionRange(pos, pos); }
  if (t.id === "rsearch") { S.ui.req.search = t.value; const pos = t.selectionStart; render(); const n = $("#rsearch"); n.focus(); n.setSelectionRange(pos, pos); }
  if (t.id === "afilter") { S.ui.assign.filter = t.value; const pos = t.selectionStart; render(); const n = $("#afilter"); n.focus(); n.setSelectionRange(pos, pos); }
});

// ---------- render ----------
function render() {
  if (!S.settings) return;
  const [r, arg] = (S.route || "home").split("/");
  renderNav();
  const advOnly = ["assign", "admin"];
  let html;
  if (advOnly.includes(r) && !isAdv()) html = `<h1>Advisor only</h1><p class="sub">Ask your advisor to do this one.</p>`;
  else html = ({ home: viewHome, pages: viewPages, page: () => viewPage(arg), proof: viewProof, requests: viewRequests, spotlight: viewSpotlight, deadlines: viewDeadlines, assign: viewAssign, admin: viewAdmin }[r] || viewHome)();
  // keep scroll position when re-rendering the same route
  const y = window.scrollY; $("#view").innerHTML = html; window.scrollTo(0, y);
  $("#sidebar").classList.remove("open");
}
window.addEventListener("hashchange", () => { S.route = location.hash.replace(/^#\//, "") || "home"; window.scrollTo(0, 0); render(); });
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
$("#signout").onclick = signOut;

async function start() {
  $("#login").classList.add("hidden"); $("#shell").classList.remove("hidden");
  S.route = location.hash.replace(/^#\//, "") || "home";
  await refresh();
  clearInterval(start.t);
  start.t = setInterval(() => { if (document.visibilityState === "visible" && !document.activeElement?.matches("input[type=text],textarea,select")) refresh(); }, 45000);
}
if (creds()) start(); else showLogin();
