// Shared by the browser (app.js) and the Netlify Function (api.mjs).
export const CATS = ["planning", "photos", "writing", "design", "proofing"];
export const CAT_LABEL = { planning: "Planning", photos: "Photos", writing: "Writing", design: "Design", proofing: "Proofing" };
export const STEPS = ["first", "second", "editor"];
export const STEP_LABEL = { first: "First Proof", second: "Second Proof", editor: "Editor Proof" };
export const DEADLINE_LABEL = {
  s1: "Sprint 1", s2: "Sprint 2", s3: "Sprint 3",
  first: "First Proof", second: "Second Proof", editor: "Editor Review", final: "Final Deadline",
};
export const STAGE_LABEL = {
  building: "Building", first: "First proof", second: "Second proof", editor: "Editor proof", final: "Awaiting approval", done: "Approved",
};

export function newPage({ num, content, template }) {
  return {
    num, content, template: template || "C", deadline: null, assignees: [], requests: [], checks: {},
    proof: { first: {}, second: {}, editor: {} }, final: {},
  };
}

export function taskList(template) {
  const out = [];
  if (!template) return out;
  for (const s of [1, 2, 3]) {
    for (const c of CATS) {
      (template.tasks?.[s]?.[c] || []).forEach((text, i) =>
        out.push({ key: `${s}.${c}.${i}`, sprint: s, cat: c, text }));
    }
  }
  return out;
}

export function pageProgress(page, templates) {
  const tasks = taskList(templates[page.template]);
  const bySprint = { 1: { done: 0, total: 0 }, 2: { done: 0, total: 0 }, 3: { done: 0, total: 0 } };
  let done = 0;
  for (const t of tasks) {
    const d = !!page.checks?.[t.key];
    bySprint[t.sprint].total++;
    if (d) { done++; bySprint[t.sprint].done++; }
  }
  const total = tasks.length;
  const ready = total > 0 && done === total;
  const proofDone = STEPS.filter((s) => page.proof?.[s]?.fixed).length;
  const allDone = done + proofDone;
  const allTotal = total ? total + STEPS.length : 0;
  return {
    done, total, ready, bySprint, proofDone,
    buildPct: total ? Math.round((done / total) * 100) : 0,
    pct: allTotal ? Math.round((allDone / allTotal) * 100) : 0,
    allDone, allTotal,
  };
}

export function stage(page, templates) {
  if (!pageProgress(page, templates).ready) return "building";
  for (const s of STEPS) if (!page.proof?.[s]?.fixed) return s;
  return page.final?.approved ? "done" : "final";
}

export function overall(pages, templates) {
  let done = 0, total = 0;
  for (const p of pages) { const g = pageProgress(p, templates); done += g.allDone; total += g.allTotal; }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Percent complete for one milestone key (s1, s2, s3, first, second, editor, final)
export function milestoneStatus(key, page, templates) {
  const g = pageProgress(page, templates);
  if (key === "s1" || key === "s2" || key === "s3") {
    const sp = g.bySprint[key.slice(1)];
    return { done: sp.done, total: sp.total, complete: sp.total > 0 && sp.done === sp.total };
  }
  if (key === "final") { const c = !!page.final?.approved; return { done: c ? 1 : 0, total: 1, complete: c }; }
  const c = !!page.proof?.[key]?.fixed;
  return { done: c ? 1 : 0, total: 1, complete: c };
}

export function milestonePct(key, pages, templates) {
  let done = 0, total = 0;
  for (const p of pages) {
    if (!pageProgress(p, templates).total) continue;
    const m = milestoneStatus(key, p, templates);
    done += m.done; total += m.total;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function endOfDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59);
}
export function daysUntil(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const a = new Date(y, m - 1, d), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}
export function isOverdue(dateStr, now = new Date()) { return now > endOfDay(dateStr); }

export function furthestAlong(pages, roster, templates) {
  const rows = roster.map((r) => {
    const mine = pages.filter((p) => p.assignees.includes(r.name));
    const prog = mine.map((p) => pageProgress(p, templates));
    const avg = prog.length ? Math.round(prog.reduce((a, g) => a + g.pct, 0) / prog.length) : 0;
    const finished = prog.filter((g) => g.ready).length;
    return { name: r.name, pages: mine.length, avg, finished };
  }).filter((r) => r.pages > 0);
  return rows.sort((a, b) => b.avg - a.avg || b.finished - a.finished || b.pages - a.pages);
}

export function topProofers(pages, roster) {
  const map = new Map(roster.map((r) => [r.name, { name: r.name, first: 0, second: 0, editor: 0, total: 0 }]));
  for (const p of pages) for (const s of STEPS) {
    const rec = p.proof?.[s];
    if (rec?.proofer && rec.fixed && map.has(rec.proofer)) { const row = map.get(rec.proofer); row[s]++; row.total++; }
  }
  return [...map.values()].filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
}

// ---------- deadlines (3 deadlines, each with 3 sprints + 3 proof benchmarks) ----------
export const BENCH = ["s1", "s2", "s3", "first", "second", "editor"];
export const BENCH_LABEL = { s1: "Sprint 1", s2: "Sprint 2", s3: "Sprint 3", first: "First Proof", second: "Second Proof", editor: "Editor Review" };

export function pagesForDeadline(pages, templates, id) {
  return pages.filter((p) => p.deadline === id && pageProgress(p, templates).total > 0);
}

export function deadlineSummary(pages, templates, set) {
  const mine = pagesForDeadline(pages, templates, set.id);
  let done = 0, total = 0;
  for (const p of mine) { const g = pageProgress(p, templates); done += g.allDone; total += g.allTotal; }
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bench = {};
  for (const k of BENCH) {
    const m = milestonePct(k, mine, templates);
    const date = set.dates?.[k] || "";
    bench[k] = { ...m, date, overdue: !!date && isOverdue(date) && m.pct < 100 };
  }
  const due = set.dates?.editor || "";
  return { id: set.id, name: set.name, pages: mine, count: mine.length, pct, done, total, bench, due, overdue: !!due && isOverdue(due) && pct < 100 };
}

// ---------- priority points & awards (used by Page Requests) ----------
export const PRIORITY = { proofPoints: 10, allStarPct: 90 };
export const AWARD_LEGEND = [
  ["🥇🥈🥉", "Top 3 in priority points"],
  ["🏆", "Completion Champion: highest average % complete"],
  ["🔍", "Proof Pro: most proofs finished"],
  ["⭐", `All-Star: ${PRIORITY.allStarPct}%+ average complete`],
];

// Points = average % complete across your pages + proofPoints for every proof you've finished.
export function priorityBoard(pages, roster, templates) {
  const fa = new Map(furthestAlong(pages, roster, templates).map((r) => [r.name, r]));
  const tp = new Map(topProofers(pages, roster).map((r) => [r.name, r]));
  const rows = roster.map((r) => {
    const f = fa.get(r.name) || { pages: 0, avg: 0, finished: 0 };
    const t = tp.get(r.name) || { total: 0 };
    return { name: r.name, editor: !!r.editor, pages: f.pages, avg: f.avg, finished: f.finished, proofs: t.total, points: f.avg + t.total * PRIORITY.proofPoints, awards: [], rank: 0 };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const medals = ["🥇", "🥈", "🥉"];
  rows.slice(0, 3).forEach((r, i) => { if (r.points > 0) r.awards.push({ icon: medals[i], label: `Priority #${i + 1}` }); });
  const withPages = rows.filter((r) => r.pages > 0);
  const bestAvg = Math.max(0, ...withPages.map((r) => r.avg));
  if (bestAvg > 0) withPages.filter((r) => r.avg === bestAvg).forEach((r) => r.awards.push({ icon: "🏆", label: "Completion Champion" }));
  const bestProofs = Math.max(0, ...rows.map((r) => r.proofs));
  if (bestProofs > 0) rows.filter((r) => r.proofs === bestProofs).forEach((r) => r.awards.push({ icon: "🔍", label: "Proof Pro" }));
  withPages.filter((r) => r.avg >= PRIORITY.allStarPct).forEach((r) => r.awards.push({ icon: "⭐", label: "All-Star" }));
  return rows;
}
