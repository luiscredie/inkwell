// The deploy workflow's job graph (.github/workflows/deploy-pages.yml), evaluated the way GitHub Actions evaluates it:
// each job's `if:` against the event, with the implicit success() when the condition has no status function, and the
// results of the jobs it needs. Scenarios: which runs publish, and which never may. No network, nothing published.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WF = fs.readFileSync(process.env.DEPLOY_WORKFLOW || path.join(HERE, '../.github/workflows/deploy-pages.yml'), 'utf8');

// ---- the jobs: name, needs, if, permissions (our workflow's own layout: 2-space job keys, 4-space job fields) ----
export function jobs(text) {
  const lines = text.split('\n'), out = {}; let inJobs = false, cur = null, field = null;
  for (const l of lines) {
    if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
    if (!inJobs) continue;
    let m;
    if ((m = l.match(/^ {2}([A-Za-z0-9_-]+):\s*$/))) { cur = out[m[1]] = { needs: [], if: null, permissions: null }; field = null; continue; }
    if (!cur || /^\s*#/.test(l)) continue;
    if ((m = l.match(/^ {4}needs:\s*(.+)$/))) { cur.needs = m[1].replace(/[[\]\s]/g, '').split(',').filter(Boolean); field = null; continue; }
    if ((m = l.match(/^ {4}if:\s*(.*)$/))) { const v = m[1].trim(); if (/^>-?$|^\|-?$/.test(v)) { cur.if = ''; field = 'if'; } else { cur.if = v; field = null; } continue; }
    if (/^ {4}permissions:\s*$/.test(l)) { cur.permissions = {}; field = 'permissions'; continue; }
    if (/^ {4}\S/.test(l)) { field = null; continue; }
    if (field === 'if' && /^ {6}/.test(l)) { cur.if += ' ' + l.trim(); continue; }
    if (field === 'permissions' && (m = l.match(/^ {6}([a-z-]+):\s*(\S+)/))) cur.permissions[m[1]] = m[2];
  }
  return out;
}

// ---- a small evaluator for GitHub expressions: literals, property paths, == != && || ! ( ), and status functions ----
function evaluate(expr, ctx, status) {
  const src = expr.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const toks = src.match(/'(?:[^']|'')*'|==|!=|&&|\|\||[()!]|[A-Za-z_][\w.-]*(?:\(\))?|\S/g) || [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const prim = () => {
    const t = next();
    if (t === '(') { const v = or(); assert.equal(next(), ')', `unbalanced: ${expr}`); return v; }
    if (t === '!') return !truthy(prim());
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === 'true') return true; if (t === 'false') return false; if (t === 'null') return null;
    if (/\(\)$/.test(t)) { const f = t.slice(0, -2); assert.ok(f in status, `unknown function ${f}`); return status[f]; }
    if (/^\d+$/.test(t)) return +t;
    return t.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  };
  const eq = () => { let a = prim(); while (peek() === '==' || peek() === '!=') { const op = next(), b = prim(); a = op === '==' ? loose(a, b) : !loose(a, b); } return a; };
  const and = () => { let a = eq(); while (peek() === '&&') { next(); const b = eq(); a = truthy(a) ? b : a; } return a; };
  const or = () => { let a = and(); while (peek() === '||') { next(); const b = and(); a = truthy(a) ? a : b; } return a; };
  const v = or(); assert.equal(i, toks.length, `could not read: ${expr}`); return v;
}
const truthy = (v) => !(v === false || v === null || v === undefined || v === 0 || v === '');
const loose = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);

// run the graph: `outcomes` says how a job that runs ends (default success); returns each job's result
export function simulate(text, event, outcomes = {}) {
  const J = jobs(text), res = {}, outputs = {};
  const order = []; const seen = new Set();
  const visit = (n) => { if (seen.has(n)) return; seen.add(n); J[n].needs.forEach(visit); order.push(n); };
  Object.keys(J).forEach(visit);
  for (const n of order) {
    const j = J[n], needs = Object.fromEntries(j.needs.map((d) => [d, { result: res[d], outputs: outputs[d] || {} }]));
    const allOk = j.needs.every((d) => res[d] === 'success');
    const status = { success: allOk, failure: j.needs.some((d) => res[d] === 'failure'), always: true, cancelled: false };
    const cond = j.if == null || j.if === '' ? 'success()' : j.if;
    const explicit = /\b(success|failure|always|cancelled)\(\)/.test(cond);
    const runs = (explicit || allOk) && truthy(evaluate(cond, { ...event, needs }, status));
    if (!runs) { res[n] = 'skipped'; continue; }
    const o = outcomes[n] ?? 'success';
    res[n] = typeof o === 'string' ? o : o.result; outputs[n] = typeof o === 'string' ? {} : o.outputs || {};
  }
  return res;
}

const REPO = 'luiscredie/inkwell';
const wr = (over = {}) => ({ github: { event_name: 'workflow_run', ref: 'refs/heads/main', repository: REPO,
  event: { workflow_run: { conclusion: 'success', event: 'push', head_branch: 'main', head_sha: 'a'.repeat(40), head_repository: { full_name: REPO }, ...over } } } });
const dispatch = (ref = 'refs/heads/main') => ({ github: { event_name: 'workflow_dispatch', ref, repository: REPO, event: {} }, inputs: { sha: 'a'.repeat(40) } });
const publishes = (r) => r.deploy === 'success';

test('automatic: the release checks of a push to main passed → build and publish', () => {
  const r = simulate(WF, wr()); assert.equal(r.build, 'success'); assert.ok(publishes(r), JSON.stringify(r));
});
test('automatic: release checks failed, were cancelled or skipped → nothing is published', () => {
  for (const c of ['failure', 'cancelled', 'skipped', 'timed_out', 'action_required']) assert.ok(!publishes(simulate(WF, wr({ conclusion: c }))), c);
});
test('automatic: checks of a pull request from a fork whose branch is called "main" → nothing is published', () => {
  const fork = wr({ event: 'pull_request', head_repository: { full_name: 'someone/inkwell' } });
  const r = simulate(WF, fork); assert.equal(r.build, 'skipped', JSON.stringify(r)); assert.ok(!publishes(r));
});
test('automatic: any run that is not a push to main of this repository → nothing is published', () => {
  for (const over of [{ event: 'pull_request' }, { event: 'pull_request_target' }, { event: 'workflow_dispatch' }, { head_branch: 'feature' },
    { head_repository: { full_name: 'someone/inkwell' } }, { head_repository: null }]) assert.ok(!publishes(simulate(WF, wr(over))), JSON.stringify(over));
});
test('manual: only from main, and only when the guard approved the commit', () => {
  assert.ok(!publishes(simulate(WF, dispatch('refs/heads/feature'))));
  assert.ok(!publishes(simulate(WF, dispatch(), { guard: 'failure' })));
  assert.ok(!publishes(simulate(WF, dispatch(), { guard: 'cancelled' })));
  assert.ok(publishes(simulate(WF, dispatch(), { guard: { result: 'success', outputs: { rollback: 'false' } } })));
});
test('manual rollback: published only after the independent approval succeeded', () => {
  const rb = { guard: { result: 'success', outputs: { rollback: 'true' } } };
  for (const a of ['failure', 'cancelled']) assert.ok(!publishes(simulate(WF, dispatch(), { ...rb, 'rollback-approval': a })), a);
  assert.ok(publishes(simulate(WF, dispatch(), { ...rb, 'rollback-approval': 'success' })));
});
test('the deploy only runs after a successful build, in its own job', () => {
  assert.deepEqual(jobs(WF).deploy.needs, ['build']);
  assert.ok(!publishes(simulate(WF, wr(), { build: 'failure' })));
});
test('least privilege: only the deploy job can publish (pages, id-token); the jobs that run repository code cannot', () => {
  const J = jobs(WF), top = WF.slice(0, WF.indexOf('\njobs:'));
  assert.ok(!/pages:\s*write/.test(top) && !/id-token:\s*write/.test(top), 'workflow-level permissions grant publishing to every job');
  assert.deepEqual(J.deploy.permissions, { pages: 'write', 'id-token': 'write' });
  for (const n of ['guard', 'rollback-approval', 'build']) {
    assert.ok(J[n].permissions, `${n}: no job-level permissions`);
    assert.ok(!('pages' in J[n].permissions) && !('id-token' in J[n].permissions), `${n} can publish`);
  }
});
