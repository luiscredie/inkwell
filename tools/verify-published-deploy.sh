#!/usr/bin/env bash
# After a deploy: was it what the rules say? Read-only (GitHub API + the site); publishes and changes nothing.
#   RUN_ID  the "Deploy Inkwell to GitHub Pages" run · REPO owner/repo · GH_TOKEN (read) · SITE (default https://inkwell.com.br)
# Checks, from the run's own logs:
#   - the run and its build and deploy jobs succeeded (automatic run: guard and rollback-approval skipped);
#   - the build job (which runs the repository's code) had no Pages permission; the deploy job had Pages: write;
#   - automatic run: the build's guard accepted the official release run of the same commit it then checked out;
#   - deploy-pages reported success; the site answers.
# Prints the commit actually published (the run's label on GitHub is main's head when it started, not that commit).
set -euo pipefail
SITE="${SITE:-https://inkwell.com.br}"
fail=0
ok() { echo "ok    $*"; }
bad() { echo "FALHA $*"; fail=1; }

[[ "${RUN_ID:-}" =~ ^[0-9]+$ ]] || { echo "FALHA execução inválida (${RUN_ID:-vazia})"; exit 1; }
r=$(gh api "repos/$REPO/actions/runs/$RUN_ID" --jq '[.name, .event, .status, (.conclusion // "")] | join("|")')
IFS='|' read -r name event status concl <<<"$r"
[ "$name" = "Deploy Inkwell to GitHub Pages" ] && ok "execução $RUN_ID é o deploy ($event)" || bad "execução $RUN_ID não é o deploy ($name)"
[ "$status/$concl" = "completed/success" ] && ok "concluída com sucesso" || bad "não concluiu com sucesso ($status/$concl)"

jobs=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs?filter=latest&per_page=20" --jq '[.jobs[] | "\(.name)=\(.conclusion)=\(.id)"] | join(" ")')
jid() { tr ' ' '\n' <<<"$jobs" | awk -F= -v n="$1" '$1==n{print $3}'; }
jres() { tr ' ' '\n' <<<"$jobs" | awk -F= -v n="$1" '$1==n{print $2}'; }
for j in build deploy; do [ "$(jres $j)" = success ] && ok "job $j: success" || bad "job $j: $(jres $j)"; done
if [ "$event" = workflow_run ]; then
  for j in guard rollback-approval; do [ "$(jres $j)" = skipped ] && ok "job $j: skipped (deploy automático)" || bad "job $j: $(jres $j) num deploy automático"; done
fi

perms() { awk '/##\[group\]GITHUB_TOKEN Permissions/{f=1;next} f&&/##\[endgroup\]/{exit} f{sub(/^[^ ]+ /,""); print}' <<<"$1"; }
blog=$(gh api "repos/$REPO/actions/jobs/$(jid build)/logs")
dlog=$(gh api "repos/$REPO/actions/jobs/$(jid deploy)/logs")
bp=$(perms "$blog"); dp=$(perms "$dlog")
[ -n "$bp" ] || bad "build: permissões do token não encontradas no log"
grep -q '^Pages:' <<<"$bp" && bad "build tinha permissão de Pages ($(grep '^Pages:' <<<"$bp")): o job que roda o código do repositório não pode publicar" || ok "build sem permissão de Pages ($(tr '\n' ' ' <<<"$bp"))"
grep -q '^Pages: write' <<<"$dp" && ok "deploy com Pages: write" || bad "deploy sem Pages: write ($(tr '\n' ' ' <<<"$dp"))"

head=$(grep -oE 'HEAD is now at [0-9a-f]{7,}' <<<"$blog" | tail -1 | awk '{print $5}') || true
[ -n "$head" ] || bad "build: commit publicado não encontrado no log"
if [ "$event" = workflow_run ]; then
  approved=$(grep -oE 'OK: [0-9a-f]{40} aprovado na execução oficial [0-9]+' <<<"$blog" | head -1) || true
  if [ -z "$approved" ]; then bad "build: a guarda do deploy automático não registrou a aprovação (tools/verify-workflow-run.sh)"
  else
    asha=$(awk '{print $2}' <<<"$approved"); arun=$(awk '{print $NF}' <<<"$approved")
    ok "guarda: $asha aprovado na execução oficial $arun"
    [ -n "$head" ] && [[ "$asha" == "$head"* ]] && ok "commit publicado = commit aprovado ($head)" || bad "commit publicado ($head) ≠ aprovado ($asha)"
  fi
fi
grep -q 'Reported success!' <<<"$dlog" && ok "deploy-pages: Reported success!" || bad "deploy-pages não reportou sucesso"

[ -n "${SKIP_SITE:-}" ] && echo "(site não consultado: SKIP_SITE)"
for p in $([ -n "${SKIP_SITE:-}" ] || echo / feed/ colecao/ decks/); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "$SITE/$p" || echo 000)
  [ "$c" = 200 ] && ok "site $p: 200" || bad "site $p: $c"
done
echo "publicado: ${head:-?} (execução $RUN_ID)"
exit $fail
