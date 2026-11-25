#!/usr/bin/env bash
# Manual deploy guard (.github/workflows/deploy-pages.yml). Publishes nothing: exits 0 only when the commit may go live.
#   SHA                 full commit SHA to publish
#   REF                 the ref the manual run was started from (must be refs/heads/main)
#   ROLLBACK_AUTH       required only when SHA is not main's current HEAD: who authorised the rollback, and when
#   ROLLBACK_CONFIRM    required with ROLLBACK_AUTH: the same SHA typed again
#   REPO                owner/repo; GH_TOKEN for the API (read only)
# Rules:
#   1. started from main only;
#   2. SHA is main's HEAD, or an ancestor of main with an explicit, written rollback authorisation;
#   3. one official "Inkwell release checks" run for exactly that SHA (event push, branch main) concluded with
#      success, and its js, python, smoke and journeys-webkit jobs all succeeded in that same run.
set -euo pipefail
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
no() { say "RECUSADO: $*"; exit 1; }

[ "${REF:-}" = "refs/heads/main" ] || no "o deploy manual só pode ser disparado a partir da main (veio de ${REF:-?})."
[[ "${SHA:-}" =~ ^[0-9a-f]{40}$ ]] || no "informe o SHA completo (40 caracteres hexadecimais)."

head=$(gh api "repos/$REPO/commits/main" --jq .sha)
if [ "$SHA" != "$head" ]; then
  st=$(gh api "repos/$REPO/compare/$SHA...main" --jq .status)
  [ "$st" = "ahead" ] || no "$SHA não está na main (compare: $st)."
  [ -n "${ROLLBACK_AUTH// /}" ] || no "$SHA não é o topo da main ($head): rollback exige autorização escrita (campo rollback_authorization)."
  [ "${ROLLBACK_CONFIRM:-}" = "$SHA" ] || no "rollback: redigite o SHA completo em rollback_confirm."
  say "Rollback autorizado: ${ROLLBACK_AUTH} (main está em $head)."
fi

# the official run: "Inkwell release checks" (validate.yml), push to main, this exact commit, concluded with success
runs=$(gh api "repos/$REPO/actions/workflows/validate.yml/runs?head_sha=$SHA&event=push&branch=main&per_page=20" \
  --jq '[.workflow_runs[] | select(.name == "Inkwell release checks" and .head_sha == "'"$SHA"'" and .status == "completed" and .conclusion == "success")] | sort_by(.id) | last | if . == null then "" else "\(.id) \(.run_attempt) \(.html_url)" end')
[ -n "$runs" ] || no "nenhuma execução oficial de \"Inkwell release checks\" (push na main) concluída com sucesso para $SHA."
read -r run attempt url <<<"$runs"
jobs=$(gh api "repos/$REPO/actions/runs/$run/jobs?filter=latest&per_page=50" --jq '[.jobs[] | "\(.name)=\(.conclusion)"] | join(" ")')
for j in js python smoke journeys-webkit; do
  [[ " $jobs " == *" $j=success "* ]] || no "na execução $run, o job $j não concluiu com sucesso ($jobs)."
done
[ "$attempt" -gt 1 ] && say "Atenção: a execução $run passou na tentativa $attempt (houve nova execução de jobs)."
say "OK: $SHA aprovado na execução oficial $run ($url): js, python, smoke e journeys-webkit com sucesso."
