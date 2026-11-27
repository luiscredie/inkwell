// The manual-deploy guards (tools/verify-deploy-sha.sh, tools/verify-rollback-approval.sh), run with a fake `gh`
// that answers the GitHub API from a table: no network, nothing published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HEAD = 'a'.repeat(40), OLD = 'b'.repeat(40), BRANCH = 'c'.repeat(40);

// a fake gh: `gh api <path> [--jq expr]` → the table's JSON for that path (query string included), filtered by jq
function run(script, env, api) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
  fs.writeFileSync(path.join(dir, 'api.json'), JSON.stringify(api));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
[ "$1" = api ] || exit 2; p="$2"; shift 2; jqx=.
while [ $# -gt 0 ]; do case "$1" in --jq) jqx="$2"; shift 2;; *) shift;; esac; done
v=$(jq -c --arg p "$p" '.[$p] // "__404__"' "${dir}/api.json")
[ "$v" = '"__404__"' ] && { echo "HTTP 404 $p" >&2; exit 1; }
jq -r "$jqx" <<<"$v"
`, { mode: 0o755 });
  const out = path.join(dir, 'out');
  const r = spawnSync('bash', [path.join(HERE, script)], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPO: 'o/r', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '', ...env }, encoding: 'utf8' });
  return { code: r.status, text: r.stdout + r.stderr, output: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '' };
}

const okRun = (sha) => ({
  [`repos/o/r/actions/workflows/validate.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=20`]: { workflow_runs: [{ id: 7, name: 'Inkwell release checks', head_sha: sha, status: 'completed', conclusion: 'success', run_attempt: 1, html_url: 'u' }] },
  'repos/o/r/actions/runs/7/jobs?filter=latest&per_page=50': { jobs: ['js', 'python', 'smoke', 'journeys-webkit'].map((name) => ({ name, conclusion: 'success' })) },
});
const base = { 'repos/o/r/commits/main': { sha: HEAD }, [`repos/o/r/compare/${OLD}...main`]: { status: 'ahead' }, [`repos/o/r/compare/${BRANCH}...main`]: { status: 'diverged' }, ...okRun(HEAD), ...okRun(OLD) };
const sha = (SHA, more = {}) => run('verify-deploy-sha.sh', { REF: 'refs/heads/main', SHA, ROLLBACK_AUTH: '', ROLLBACK_CONFIRM: '', ...more }, base);

test('deploy SHA: main HEAD approved by the official run → accepted, not a rollback', () => {
  const r = sha(HEAD); assert.equal(r.code, 0, r.text); assert.match(r.output, /rollback=false/);
});
test('deploy SHA: from another branch, a short SHA, a branch commit → refused', () => {
  assert.match(run('verify-deploy-sha.sh', { REF: 'refs/heads/x', SHA: HEAD }, base).text, /só pode ser disparado a partir da main/);
  assert.match(sha('abc123').text, /SHA completo/);
  assert.match(sha(BRANCH, { ROLLBACK_AUTH: 'x', ROLLBACK_CONFIRM: BRANCH }).text, /não está na main/);
});
test('deploy SHA: an older main commit needs the written authorisation and the SHA typed again; then it is a rollback', () => {
  assert.notEqual(sha(OLD).code, 0);
  assert.match(sha(OLD, { ROLLBACK_AUTH: 'Conselho 26/11' }).text, /redigite o SHA/);
  const r = sha(OLD, { ROLLBACK_AUTH: 'Conselho 26/11', ROLLBACK_CONFIRM: OLD });
  assert.equal(r.code, 0, r.text); assert.match(r.output, /rollback=true/); assert.match(r.text, /aprovação independente/);
});
test('deploy SHA: a job that did not succeed in the official run → refused', () => {
  const api = { ...base, 'repos/o/r/actions/runs/7/jobs?filter=latest&per_page=50': { jobs: [{ name: 'js', conclusion: 'success' }, { name: 'python', conclusion: 'success' }, { name: 'smoke', conclusion: 'failure' }, { name: 'journeys-webkit', conclusion: 'success' }] } };
  const r = run('verify-deploy-sha.sh', { REF: 'refs/heads/main', SHA: HEAD }, api);
  assert.notEqual(r.code, 0); assert.match(r.text, /smoke não concluiu com sucesso/);
});

// independent approval of a rollback
const ENV = (rule) => ({ 'repos/o/r/environments/rollback': { name: 'rollback', protection_rules: rule ? [rule] : [] } });
const APPROVALS = (list) => ({ 'repos/o/r/actions/runs/9/approvals': list });
const reviewers = { type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { login: 'outra-pessoa' } }] };
const approve = (api) => run('verify-rollback-approval.sh', { RUN_ID: '9', ACTOR: 'luiscredie' }, api);
const by = (login, envName = 'rollback', state = 'approved') => ({ state, user: { login }, environments: [{ name: envName }] });

test('rollback approval: no protected environment, no reviewers, or self-review allowed → refused (fails closed)', () => {
  assert.match(approve({ ...APPROVALS([by('outra-pessoa')]) }).text, /não existe/);
  assert.match(approve({ ...ENV(null), ...APPROVALS([by('outra-pessoa')]) }).text, /não exige revisores/);
  assert.match(approve({ ...ENV({ ...reviewers, reviewers: [] }), ...APPROVALS([by('outra-pessoa')]) }).text, /não tem revisores/);
  assert.match(approve({ ...ENV({ ...reviewers, prevent_self_review: false }), ...APPROVALS([by('outra-pessoa')]) }).text, /Prevent self-review/);
});
test('rollback approval: only the person who started it, a rejection, or another environment → refused', () => {
  assert.match(approve({ ...ENV(reviewers), ...APPROVALS([by('luiscredie')]) }).text, /não é independente/);
  assert.match(approve({ ...ENV(reviewers), ...APPROVALS([by('outra-pessoa', 'rollback', 'rejected')]) }).text, /nenhuma aprovação/);
  assert.match(approve({ ...ENV(reviewers), ...APPROVALS([by('outra-pessoa', 'github-pages')]) }).text, /nenhuma aprovação/);
});
test('rollback approval: approved by someone else → accepted', () => {
  const r = approve({ ...ENV(reviewers), ...APPROVALS([by('luiscredie'), by('outra-pessoa')]) });
  assert.equal(r.code, 0, r.text); assert.match(r.text, /independente por: outra-pessoa/);
});
