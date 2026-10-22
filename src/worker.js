// Yearbook Hub API for Cloudflare Workers + D1 (SQLite). The web page itself is served from /public.
import { SEED } from "./seed.js";
import { newPage, stage, taskList, STEPS } from "../public/logic.js";

const json = (data, status = 200) =>
  new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const fail = (msg, status = 400) => json({ error: msg }, status);

// ---------- database helpers ----------
const pickDates = (o = {}) => ({ s1: o.s1 || "", s2: o.s2 || "", s3: o.s3 || "", first: o.first || "", second: o.second || "", editor: o.editor || "" });
const defaultSets = (flat) => [
  { id: 1, name: "Deadline 1", dates: pickDates(flat) },
  { id: 2, name: "Deadline 2", dates: pickDates() },
  { id: 3, name: "Deadline 3", dates: pickDates() },
];

let ready = false;
async function init(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pages (num INTEGER PRIMARY KEY, data TEXT NOT NULL)"),
  ]);
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'settings'").first();
  if (!row) {
    // First visit: load the roster, pages 1-124, and checklists. Pages start with NO students assigned.
    const settings = { deadlineSets: defaultSets(SEED.deadlines), spotlight: true, requestsOpen: true, requestLimit: 5, templates: SEED.templates };
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO pages (num, data) SELECT json_extract(value, '$.num'), value FROM json_each(?)").bind(JSON.stringify(SEED.pages.map(newPage))),
      env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('roster', ?)").bind(JSON.stringify(SEED.roster)),
      env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('version', '1')"),
      env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('settings', ?)").bind(JSON.stringify(settings)),
    ]);
  }
  ready = true;
}
async function readMeta(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM meta").all();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { settings: JSON.parse(m.settings), roster: JSON.parse(m.roster), version: Number(m.version), raw: m };
}
const rawPages = async (env) => (await env.DB.prepare("SELECT data FROM pages ORDER BY num").all()).results.map((r) => r.data);
const loadPages = async (env) => (await rawPages(env)).map((s) => JSON.parse(s));
async function getPage(env, n) {
  const r = await env.DB.prepare("SELECT data FROM pages WHERE num = ?").bind(Number(n)).first();
  return r ? JSON.parse(r.data) : null;
}
// Statements (not yet run). Every write batch also bumps the version so other browsers know to refresh.
const pageStmts = (env, pages) => {
  const out = [];
  for (let i = 0; i < pages.length; i += 100)
    out.push(env.DB.prepare("INSERT OR REPLACE INTO pages (num, data) SELECT json_extract(value, '$.num'), value FROM json_each(?)").bind(JSON.stringify(pages.slice(i, i + 100))));
  return out;
};
const metaStmt = (env, key, value) => env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").bind(key, JSON.stringify(value));
const write = (env, stmts) => env.DB.batch([...stmts, env.DB.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'version'")]);
const savePage = (env, page) => write(env, pageStmts(env, [page]));

function auth(request, env, roster) {
  const adv = request.headers.get("x-advisor");
  if (adv && env.ADVISOR_PASSCODE && adv === env.ADVISOR_PASSCODE) return { role: "advisor", name: "Advisor" };
  const code = request.headers.get("x-code");
  let name = "";
  try { name = decodeURIComponent(request.headers.get("x-name") || ""); } catch {}
  if (code && env.STUDENT_CODE && code === env.STUDENT_CODE && roster.some((r) => r.name === name)) return { role: "student", name };
  return null;
}

// ---------- handler ----------
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : fail("Not found", 404);
      if (!env.DB) return fail("The database isn't connected yet. Check the d1_databases section of wrangler.jsonc (SETUP.md, step 2).", 500);
      const path = url.pathname.replace(/^\/api\/?/, "");
      await init(env);
      const meta = await readMeta(env);
      const { settings, roster } = meta;

      if (path === "roster" && request.method === "GET") return json({ names: roster.map((r) => r.name) });

      if (!env.STUDENT_CODE || !env.ADVISOR_PASSCODE)
        return fail("Site setup incomplete: add STUDENT_CODE and ADVISOR_PASSCODE as secrets in Cloudflare (Settings > Variables and Secrets), then redeploy.", 500);

      const user = auth(request, env, roster);
      if (path === "login") return user ? json({ role: user.role, name: user.name }) : fail("Wrong name or code.", 401);
      if (!user) return fail("Please sign in again.", 401);

      const isAdv = user.role === "advisor";
      // Only advisors and editors can see everyone's page requests. Students only get their own.
      const reviewer = isAdv || !!roster.find((r) => r.name === user.name)?.editor;
      const clean = (p) => reviewer ? p : { ...p, requests: (p.requests || []).filter((r) => r.name === user.name), requestCount: (p.requests || []).filter((r) => r.status !== "declined").length };

      if (path === "state" && request.method === "GET") {
        const v = url.searchParams.get("v");
        if (v && Number(v) === meta.version) return json({ unchanged: true, version: meta.version });
        const rows = await rawPages(env);
        // Pages with no requests can be passed straight through, which keeps the work per request small.
        const body = reviewer ? rows.join(",") : rows.map((s) => s.includes('"requests":[]') ? s : JSON.stringify(clean(JSON.parse(s)))).join(",");
        return json(`{"settings":${meta.raw.settings},"roster":${meta.raw.roster},"pages":[${body}],"me":${JSON.stringify(user)},"version":${meta.version}}`);
      }
      if (request.method !== "POST") return fail("Not found", 404);
      const b = await request.json();

      // ----- checklist -----
      if (path === "check") {
        const page = await getPage(env, b.page);
        if (!page) return fail("No such page", 404);
        if (!isAdv && !page.assignees.includes(user.name)) return fail("Only students assigned to this page can check boxes.", 403);
        if (!taskList(settings.templates[page.template]).some((t) => t.key === b.key)) return fail("Unknown task");
        // Change just this one box inside the stored page, so two students checking at once never overwrite each other.
        const sql = b.value
          ? "UPDATE pages SET data = json_set(data, '$.checks.\"' || ? || '\"', json('true')) WHERE num = ?"
          : "UPDATE pages SET data = json_remove(data, '$.checks.\"' || ? || '\"') WHERE num = ?";
        await write(env, [env.DB.prepare(sql).bind(b.key, Number(b.page))]);
        if (b.value) page.checks[b.key] = true; else delete page.checks[b.key];
        return json({ page: clean(page) });
      }

      // ----- proofing -----
      if (path === "proof") {
        const page = await getPage(env, b.page);
        if (!page) return fail("No such page", 404);
        const step = b.step;
        if (!STEPS.includes(step)) return fail("Unknown proof step");
        const rec = page.proof[step] || (page.proof[step] = {});
        const st = stage(page, settings.templates);
        const isAssignee = page.assignees.includes(user.name);
        const isProofer = rec.proofer === user.name;
        const me = roster.find((r) => r.name === user.name);
        switch (b.action) {
          case "claim": {
            if (isAdv) return fail("Advisors can reset or approve, but proofing is for students.");
            if (st !== step) return fail("This page isn't in that proof step right now.");
            if (rec.proofer) return fail(`Already being proofed by ${rec.proofer}.`);
            if (isAssignee) return fail("You can't proof a page you're assigned to.");
            const earlier = STEPS.slice(0, STEPS.indexOf(step)).map((s) => page.proof[s]?.proofer);
            if (earlier.includes(user.name)) return fail("Choose a different proofer than the earlier steps.");
            if (step === "editor" && !me?.editor) return fail("Only editors can do the Editor Proof.");
            page.proof[step] = { proofer: user.name, notes: "", fixed: false, at: Date.now() };
            break;
          }
          case "release":
            if (!(isProofer || isAdv) || rec.fixed) return fail("You can't release this page.");
            page.proof[step] = {};
            break;
          case "notes":
            if (!(isProofer || isAdv) || rec.fixed) return fail("Only the proofer can edit notes.");
            rec.notes = String(b.notes || "").slice(0, 2000);
            break;
          case "nopass":
            if (!(isProofer || isAdv) || rec.fixed || !rec.proofer) return fail("Not allowed.");
            rec.fixed = true; rec.noEdits = true; rec.fixedAt = Date.now();
            break;
          case "fixed":
            if (!(isAssignee || isAdv)) return fail("Only the students assigned to this page can mark edits made.", 403);
            if (!rec.proofer) return fail("Nobody has claimed this proof yet.");
            rec.fixed = true; rec.fixedBy = user.name; rec.fixedAt = Date.now();
            break;
          case "reset":
            if (!isAdv) return fail("Advisor only.", 403);
            for (const s of STEPS.slice(STEPS.indexOf(step))) page.proof[s] = {};
            page.final = {};
            break;
          default: return fail("Unknown action");
        }
        await savePage(env, page);
        return json({ page: clean(page) });
      }

      // ----- page requests -----
      if (path === "request") {
        if (isAdv) return fail("Page requests are for students.");
        const page = await getPage(env, b.page);
        if (!page) return fail("No such page", 404);
        const reqs = page.requests || [];
        const mine = reqs.find((r) => r.name === user.name);
        if (b.action === "add") {
          if (settings.requestsOpen === false) return fail("Page requests are closed right now.");
          if (mine) return fail("You already requested this page.");
          if (page.assignees.includes(user.name)) return fail("You're already assigned to this page.");
          if (page.assignees.length >= 3) return fail("This page already has 3 students.");
          const limit = settings.requestLimit ?? 5;
          const used = (await loadPages(env)).filter((p) => (p.requests || []).some((r) => r.name === user.name && r.status !== "declined")).length;
          if (used >= limit) return fail(`You can request up to ${limit} pages. Withdraw one first.`);
          reqs.push({ name: user.name, at: Date.now(), status: "pending" });
          page.requests = reqs;
        } else if (b.action === "remove") {
          if (!mine) return fail("You haven't requested this page.");
          page.requests = reqs.filter((r) => r.name !== user.name);
        } else return fail("Unknown action");
        await savePage(env, page);
        return json({ page: clean(page) });
      }

      if (path === "grant") {
        if (!reviewer) return fail("Only advisors and editors can assign requested pages.", 403);
        const page = await getPage(env, b.page);
        if (!page) return fail("No such page", 404);
        const rec = (page.requests || []).find((r) => r.name === b.student);
        if (!rec) return fail("That student hasn't requested this page.");
        if (!isAdv && b.student === user.name) return fail("Ask the advisor or another editor to review your own request.", 403);
        if (b.action === "assign") {
          if (page.assignees.length >= 3) return fail("This page already has 3 students.");
          if (!page.assignees.includes(b.student)) page.assignees.push(b.student);
          page.requests = page.requests.filter((r) => r.name !== b.student);
        } else if (b.action === "decline") {
          rec.status = "declined";
        } else return fail("Unknown action");
        await savePage(env, page);
        return json({ page });
      }

      if (path === "final") {
        if (!isAdv) return fail("Advisor only.", 403);
        const page = await getPage(env, b.page);
        if (!page) return fail("No such page", 404);
        if (b.approve) {
          if (stage(page, settings.templates) !== "final") return fail("Page hasn't finished all proofs yet.");
          page.final = { approved: true, at: Date.now() };
        } else page.final = {};
        await savePage(env, page);
        return json({ page });
      }

      // ----- everything below is advisor only -----
      if (!isAdv) return fail("Advisor only.", 403);

      if (path === "assign") {
        const { pages, mode, students = [] } = b;
        const valid = new Set(roster.map((r) => r.name));
        if (students.some((s) => !valid.has(s))) return fail("Unknown student in list.");
        const all = await loadPages(env);
        const byNum = new Map(all.map((p) => [p.num, p]));
        const results = [], changed = [];
        for (const n of pages || []) {
          const page = byNum.get(Number(n));
          if (!page) continue;
          let list = page.assignees || [];
          if (mode === "add") list = [...new Set([...list, ...students])];
          else if (mode === "remove") list = list.filter((s) => !students.includes(s));
          else if (mode === "replace") list = [...new Set(students)];
          else if (mode === "clear") list = [];
          else return fail("Unknown mode");
          if (list.length > 3) { results.push({ page: n, error: "Max 3 students per page" }); continue; }
          page.assignees = list;
          page.requests = (page.requests || []).filter((r) => !list.includes(r.name));
          changed.push(page);
          results.push({ page: n, ok: true });
        }
        if (changed.length) await write(env, pageStmts(env, changed));
        return json({ results, pages: all });
      }

      if (path === "setdeadline") {
        const id = b.deadline === null || b.deadline === "" ? null : Number(b.deadline);
        if (id !== null && !settings.deadlineSets.some((s) => s.id === id)) return fail("Unknown deadline.");
        const all = await loadPages(env);
        const want = new Set((b.pages || []).map(Number));
        const changed = all.filter((p) => want.has(p.num));
        changed.forEach((p) => { p.deadline = id; });
        if (changed.length) await write(env, pageStmts(env, changed));
        return json({ pages: all });
      }

      if (path === "admin") {
        switch (b.action) {
          case "saveDeadlines":
            settings.deadlineSets = (b.deadlineSets || []).slice(0, 3).map((s, i) => ({ id: i + 1, name: String(s.name || `Deadline ${i + 1}`).slice(0, 40), dates: pickDates(s.dates) }));
            await write(env, [metaStmt(env, "settings", settings)]); break;
          case "setRequestOptions":
            settings.requestsOpen = !!b.open;
            settings.requestLimit = Math.min(20, Math.max(1, parseInt(b.limit, 10) || 5));
            await write(env, [metaStmt(env, "settings", settings)]); break;
          case "setSpotlight":
            settings.spotlight = !!b.value;
            await write(env, [metaStmt(env, "settings", settings)]); break;
          case "saveRoster": {
            const next = (b.roster || []).map((r) => ({ name: String(r.name).trim(), editor: !!r.editor })).filter((r) => r.name);
            const keep = new Set(next.map((r) => r.name));
            const removed = roster.filter((r) => !keep.has(r.name));
            const stmts = [metaStmt(env, "roster", next)];
            if (removed.length) {
              const changed = [];
              for (const p of await loadPages(env)) {
                const a = p.assignees.filter((s) => keep.has(s));
                const rq = (p.requests || []).filter((r) => keep.has(r.name));
                if (a.length !== p.assignees.length || rq.length !== (p.requests || []).length) { p.assignees = a; p.requests = rq; changed.push(p); }
              }
              if (changed.length) stmts.push(...pageStmts(env, changed));
            }
            await write(env, stmts); break;
          }
          case "addPage": {
            const num = parseInt(b.num, 10);
            if (!num || (await getPage(env, num))) return fail("That page number already exists.");
            await savePage(env, newPage({ num, content: String(b.content || "New page"), template: b.template })); break;
          }
          case "updatePage": {
            const page = await getPage(env, b.num);
            if (!page) return fail("No such page", 404);
            if (b.content !== undefined) page.content = String(b.content);
            if (b.template && settings.templates[b.template]) page.template = b.template;
            await savePage(env, page); break;
          }
          case "deletePage":
            await write(env, [env.DB.prepare("DELETE FROM pages WHERE num = ?").bind(Number(b.num))]); break;
          case "import": {
            // Accepts the data copied from the old Netlify site (its /api/state response).
            const d = b.data || {}, st = d.settings || {};
            const roster2 = (d.roster || []).map((r) => ({ name: String(r.name).trim(), editor: !!r.editor })).filter((r) => r.name);
            const pages2 = (d.pages || []).filter((p) => p && p.num).map((p) => ({
              ...newPage({ num: Number(p.num), content: String(p.content ?? ""), template: p.template }),
              deadline: p.deadline ?? null, assignees: p.assignees || [], checks: p.checks || {}, final: p.final || {},
              proof: { first: p.proof?.first || {}, second: p.proof?.second || {}, editor: p.proof?.editor || {} },
              requests: (p.requests || []).map((r) => ({ name: r.name, at: r.at || Date.now(), status: r.status || "pending" })),
            }));
            if (!roster2.length || !pages2.length) return fail("That doesn't look like data copied from the old site.");
            const settings2 = {
              deadlineSets: st.deadlineSets || defaultSets(st.deadlines), spotlight: st.spotlight !== false,
              requestsOpen: st.requestsOpen !== false, requestLimit: st.requestLimit ?? 5, templates: st.templates || SEED.templates,
            };
            await write(env, [metaStmt(env, "settings", settings2), metaStmt(env, "roster", roster2), ...pageStmts(env, pages2)]); break;
          }
          default: return fail("Unknown action");
        }
        const fresh = await readMeta(env);
        return json({ settings: fresh.settings, roster: fresh.roster, pages: await loadPages(env) });
      }

      return fail("Not found", 404);
    } catch (err) {
      console.error(err);
      return fail("Server error: " + (err.message || err), 500);
    }
  },
};
