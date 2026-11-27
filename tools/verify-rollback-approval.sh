#!/usr/bin/env bash
# Independent approval of a rollback (.github/workflows/deploy-pages.yml, job rollback-approval). This job runs in the
# protected environment "rollback", so GitHub only starts it after a required reviewer approved. Before anything is
# published this script checks, read-only, that the approval really was independent; it fails closed otherwise:
#   - the environment "rollback" exists with a required-reviewers rule, at least one reviewer, and self-review blocked;
#   - this run has an approval for "rollback" from someone other than the person who started the run.
#   REPO owner/repo · RUN_ID this run · ACTOR who started it (github.triggering_actor) · GH_TOKEN (read only)
set -euo pipefail
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
no() { say "RECUSADO: $*"; exit 1; }

[[ "${RUN_ID:-}" =~ ^[0-9]+$ ]] || no "execução inválida (${RUN_ID:-vazia})."
[ -n "${ACTOR:-}" ] || no "não se sabe quem disparou o deploy: sem isso a aprovação não pode ser verificada como independente."
env=$(gh api "repos/$REPO/environments/rollback" 2>/dev/null) || no "o ambiente protegido \"rollback\" não existe ou não pôde ser lido."
rule=$(jq -c '[.protection_rules[]? | select(.type == "required_reviewers")][0] // empty' <<<"$env")
[ -n "$rule" ] || no "o ambiente \"rollback\" não exige revisores: um rollback sem aprovação independente não é publicado."
n=$(jq '.reviewers | length' <<<"$rule")
[ "$n" -ge 1 ] || no "o ambiente \"rollback\" não tem revisores."
[ "$(jq -r '.prevent_self_review // false' <<<"$rule")" = "true" ] || no "o ambiente \"rollback\" permite que quem disparou aprove a si mesmo (\"Prevent self-review\" desligado)."

who=$(gh api "repos/$REPO/actions/runs/$RUN_ID/approvals" \
  --jq '[.[] | select(.state == "approved") | select([.environments[]?.name] | index("rollback")) | .user.login] | unique | join(" ")')
[ -n "$who" ] || no "nenhuma aprovação registrada para o ambiente \"rollback\" nesta execução."
# GitHub logins ignore letter case: compare them lowercased
actor=$(tr '[:upper:]' '[:lower:]' <<<"$ACTOR")
indep=""; for u in $who; do [ "$(tr '[:upper:]' '[:lower:]' <<<"$u")" != "$actor" ] && indep="$indep $u"; done
[ -n "$indep" ] || no "a única aprovação veio de quem disparou o deploy ($ACTOR): não é independente."
say "Rollback aprovado de forma independente por:$indep (disparado por $ACTOR)."
