#!/usr/bin/env bash
# Automatic deploy guard (.github/workflows/deploy-pages.yml, job build, event workflow_run). Publishes nothing: exits 0
# only when the run that triggered the deploy is the official release run of a commit on main of this repository.
#   RUN_ID  the triggering run (github.event.workflow_run.id) · SHA  its head_sha · REPO owner/repo · GH_TOKEN (read)
# Why: "Inkwell release checks" also runs on pull requests, and the workflow_run branch filter matches only the
# branch *name*: a pull request from a fork whose branch is called "main" would otherwise be built and published.
# Rules: the run is "Inkwell release checks" from .github/workflows/validate.yml, event push, branch main, from this
# repository, for exactly SHA, completed with success; js, python, smoke and journeys-webkit succeeded in it; and SHA is
# on main.
set -euo pipefail
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
no() { say "RECUSADO: $*"; exit 1; }

[[ "${RUN_ID:-}" =~ ^[0-9]+$ ]] || no "execução de origem inválida (${RUN_ID:-vazia})."
[[ "${SHA:-}" =~ ^[0-9a-f]{40}$ ]] || no "SHA de origem inválido (${SHA:-vazio})."

r=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq '[.name, .path, .event, .head_branch, (.head_repository.full_name // ""), .head_sha, .status, (.conclusion // "")] | join("|")') \
  || no "não foi possível ler a execução $RUN_ID."
IFS='|' read -r name wpath event branch hrepo hsha status concl <<<"$r"
[ "$name" = "Inkwell release checks" ] && [ "$wpath" = ".github/workflows/validate.yml" ] || no "a execução $RUN_ID não é \"Inkwell release checks\" ($name, $wpath)."
[ "$event" = "push" ] || no "a execução $RUN_ID veio de \"$event\", não de um push na main."
[ "$branch" = "main" ] || no "a execução $RUN_ID é da branch \"$branch\", não da main."
[ "$hrepo" = "$REPO" ] || no "a execução $RUN_ID é de outro repositório (\"$hrepo\")."
[ "$hsha" = "$SHA" ] || no "a execução $RUN_ID testou $hsha, não $SHA."
[ "$status" = "completed" ] && [ "$concl" = "success" ] || no "a execução $RUN_ID não concluiu com sucesso ($status/$concl)."

jobs=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs?filter=latest&per_page=50" --jq '[.jobs[] | "\(.name)=\(.conclusion)"] | join(" ")')
for j in js python smoke journeys-webkit; do
  [[ " $jobs " == *" $j=success "* ]] || no "na execução $RUN_ID, o job $j não concluiu com sucesso ($jobs)."
done

st=$(gh api "repos/$REPO/compare/$SHA...main" --jq .status) || no "não foi possível comparar $SHA com a main."
[ "$st" = "identical" ] || [ "$st" = "ahead" ] || no "$SHA não está na main (compare: $st)."
say "OK: $SHA aprovado na execução oficial $RUN_ID (push na main deste repositório): js, python, smoke e journeys-webkit com sucesso."
