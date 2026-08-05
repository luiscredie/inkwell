# Inkwell — Roadmap reconciliado

Atualizado em 2026-07-28. Raiz canônica de publicação: `site/`.
Entrada canônica: `site/index.html`. `Inkwell.dc.html` é apenas um espelho
byte a byte para desenvolvimento.

## M3V V5 — Match Center visual e coaching (DONE, code)

O Match Center passa de histórico técnico para ciclo de melhoria do jogador,
sem novo schema e sem IA obrigatória:

- “Próximo treino” derivado das cinco partidas mais recentes;
- padrões recorrentes de derrota, aderência ao plano, início da corrida de lore
  e dificuldade para fechar tratados como sinais separados;
- forma recente (últimas cinco versus cinco anteriores), sequência atual,
  média de aderência e cobertura de logs detalhados;
- desempenho por deck salvo, sempre identificado por `deck_id`;
- histórico enriquecido com placar de lore, condição, nota e disponibilidade
  de replay;
- revisão de partida com ação concreta e fatos observáveis, sem apresentar
  inferência como certeza;
- conteúdo completo em EN/PT e layout responsivo;
- função pura `computeMatchCenterInsights()` e suíte canônica V5.

Persistência, importador, replay, sincronização e formato de partidas não foram
alterados. Recomendações são recalculadas a partir de `state.matches`.

## M1.7 — Advisor explicável (DONE, code)
Três blocos: Monte agora (deckStatus + targetCopies 0–10), Cartas compartilhadas
(sharedConflicts com have/demanda/decisão), Próximo deck (purchasesToUnlockNext
canônico). Simulação "Priorizar este deck" (transiente, confirm/reset — não
persiste até confirmar). "Adicionar faltantes à wishlist". EN/PT completos.

## M1.8 — Meta Scout (SCOPED, blocked on data)
App consome artefato opcional `site/data/meta-decks.json` (schema_version,
generated_at, format, source_url/type, event/placement/record, deck_id/archetype/
inks, cartas canônicas, sample_size/confidence, how_to_play, mulligan_guide,
early/mid/late, strengths/weaknesses, difficulty, budget_band). Nova aba "Meta"
(decks recomendados, NÃO seed em state.decks). Por deck: comparação com coleção
(tenho X/60, faltantes, custo, legalidade, overlap com decks salvos, montável-agora).
Selo Comprovado-em-torneio (InkDecks) vs Popular (Dreamborn). Sem win-rate sem
numerador+denominador+fonte. BLOQUEADO: pipeline precisa gerar meta-decks.json +
entrada no manifest (sha256/bytes). App não faz scraping em runtime.

## M1.9 — Player Academy (SCOPED)
Iniciantes: primeira-partida guiada, mulligan trainer (usa deck ativo, gera mãos,
explica manter por curva/inkability/plano), glossário contextual (já existe base),
saúde do deck (curva, % tintável, custo médio, tipos, risco de mão travada em
linguagem simples), "por que esta carta?" (papel: início/remoção/compra/
finalizador/sinergia). Intermediários: deck vs referência, plano de matchup,
revisão pós-partida guiada, treinos de decisão, meta pessoal, upgrade de maior
impacto (usa optimizer). Tudo derivado de state.decks + cards; sem dados externos.

## M2.0 — Replay Fidelity v3 (BLOCKED on sample logs)
Instâncias por carta (cópias repetidas), zonas separadas personagem/item/local,
STR/WILL vivos + modificadores temporários das linhas de stat do log, sing exert,
faces de tinta na ink row, dano por instância/jogador, "mostrar info oculta"
(off por default), incerteza explícita (exact_board_state:false, "Resultado
registrado" em vez de vitória inferida). BLOQUEADO: precisa de logs de exemplo
com linhas STR/WILL/sing/stat-change antes de escrever o parser.

## Regras congeladas

- Não criar `index.html` na raiz do repositório.
- Não editar manualmente `site/data/**`, `site/data-manifest.json` ou
  `site/lorcana-card-images/**`.
- Decks e partidas pertencem ao perfil ativo. O Match Center usa apenas
  `state.decks` do usuário ativo; não existem decks de exemplo embutidos.
- Nenhum deploy/push sem aprovação.
- Um item pós-release não bloqueia a versão corrente sem uma falha reproduzível
  no escopo da versão.

## R0 — Release 1.5.1

### R0.1 — Código M1P-R

Status: **CONCLUÍDO E RECONCILIADO**.

- Overview player-first e price movers.
- Otimizador de portfólio de decks.
- Match Center com importação, análise e timeline.
- Persistência de `activeDeckId`.
- Navegação de cartas, fallback de arte e validação antes da mutação.
- Correções independentes de load/import/sync do deck ativo e limpeza de replay.

Evidência executada neste build:

- release-contract JS: 9/9
- image fallback: 7/7
- UI contract: 29/29
- price movers: 12/12
- deck allocation: 19/19
- Match Center: 12/12
- Match Center R3: 12/12
- Match Center legacy core: 14 assertions
- legality engine: 25/25
- Python: 26/26

### R0.2 — Publicação de `site/` na raiz do Pages

Status: **CORREÇÃO DE CÓDIGO INCLUÍDA; AÇÃO ÚNICA NO GITHUB PENDENTE**.

Constatação em 2026-07-28:

- `https://luiscredie.github.io/inkwell/` retornava 404;
- `https://luiscredie.github.io/inkwell/site/` retornava 200.

O workflow `.github/workflows/deploy-pages.yml` agora publica o conteúdo de
`site/` como a raiz do Pages, somente depois de `Inkwell release checks`
concluir com sucesso. No GitHub, selecionar uma vez:

`Settings → Pages → Build and deployment → Source: GitHub Actions`.

Definição de pronto:

- `/inkwell/` retorna 200 e abre o app;
- `/inkwell/data-manifest.json` retorna 200;
- assets, dados e imagens carregam sem prefixo `/site/`;
- o workflow de deploy aponta para o mesmo SHA validado pela CI.

### R0.3 — Dados de preços

Status: **CONCLUÍDO E VALIDADO NO PUBLICADO**.

Auditoria de 2026-07-28:

- manifest schema 1, gerado em `2026-07-28T20:34:27.977358+00:00`;
- cards 3: 3.442 cartas;
- prices 2: 3.300 IDs com preço;
- price-history 1: 3 snapshots;
- `prices` e `price_history` com sha256 e bytes iguais ao manifesto;
- `validate_release.py --quick` contra os seis artefatos publicados: PASS.

Observação: a árvore completa de imagens não foi baixada nessa verificação; o
validador de card art continua sendo um gate separado.

### R0.4 — Verificação externa final

Status: **PARCIAL**.

Já executado localmente:

- matriz JS completa;
- 26 testes Python;
- validação do snapshot final com a tradução integrada.

Ainda precisa executar no repositório completo:

- GitHub Actions verde para JS, Python e Playwright;
- Playwright smoke contra o app servido;
- validação completa de card art com a árvore de imagens;
- confirmação visual do menu de ordenação no Edge/Windows.

### R0.5 — Tradução PT-BR

Status: **CONCLUÍDO E INTEGRADO**.

- overlay revisado para os mesmos 3.442 `card_id` do banco inglês;
- 3.646 habilidades, 2.679 textos melhorados e zero pendências automáticas;
- 6/6 testes da tradução;
- `cards.pt.json` e `data-manifest.json` empacotados juntos;
- checksum/tamanho regenerados por `tools/refresh_data_manifest.py`;
- snapshot final passou em `validate_release.py --root site --quick`.

## R1 — Replay fidelity v3

Status: **PRÓXIMO BUILD; NÃO BLOQUEIA R0**.

O replay atual é uma timeline determinística de eventos e declara
`exact_board_state: false`. Não apresentar reconstrução inferida como estado
exato.

Escopo:

1. estado por carta com STR/WILL base e modificadores temporários;
2. parser de mudanças de atributo, com duração e expiração explícitas;
3. cantar: exertar o cantor e registrar a música fora da mesa;
4. inkwell com faces ocultas e rotação visual de cartas exertadas;
5. zonas separadas para personagens, itens e locais;
6. lore e custo de movimento de locais;
7. estados Bodyguard, Ward, Resist e Evasive somente quando confirmados;
8. revisão passo a passo com logs de referência.

Critérios:

- fixtures para cada semântica;
- evento desconhecido preservado sem inventar estado;
- reprodução determinística;
- troca de perfil/partida limpa timers e estado;
- EN/PT e desktop/mobile.

## R2 — Legality engine

Status: **CONCLUÍDO, RECONCILIADO E VERIFICADO**.

O engine possui fonte data-driven para:

- sets legais;
- banimentos por ID/nome;
- tamanho mínimo;
- limite padrão e overrides de cópias;
- `validForDeck()` e `validateDeck()` consomem essas regras.

- `maximum_ink_colors` canônico e adapter para `maximum_inks`;
- diagnóstico estruturado por código, mensagem e `card_id`;
- limite de inks no builder, criação, importação e validação completa;
- importações incompletas permitidas para edição;
- violações duras bloqueadas antes de persistir;
- 25/25 testes canônicos.

O `index.html` do delta não foi adotado integralmente: continha Replay visual
fora do escopo e reintroduzia a exclusão incorreta do deck ativo e um segundo
`delMatch()`. Somente a legalidade foi portada por diff.

## R3 — Localização e qualidade de dados

Status: **OVERLAY PT-BR CONCLUÍDO; QUALIDADE CONTÍNUA**.

- overlay PT-BR revisado incorporado;
- manter merge por `card_id` e `ability_id`;
- se a habilidade não puder ser alinhada com segurança, usar EN para a carta
  inteira em vez de associar textos por índice;
- relatório de cobertura, órfãos e fallback;
- auditoria contínua de arte, preço e inkability por `card_id`.

## R4 — Qualidade de produto

Status: **DEFERIDO**.

- perfis seguros v2 e sincronização multi-dispositivo;
- diálogos acessíveis com focus trap e restauração de foco;
- lazy-load/virtualização das listas grandes;
- aprofundamento do coach com evidências de logs;
- melhoria visual responsiva do Match Center.

## R5 — Ideias a definir

- simulador de mão inicial/mulligan;
- compartilhamento/export de decks;
- gerenciador de duplicatas para troca;
- comparação com meta;
- Supabase multi-device após configuração e política de segurança.

## Ordem recomendada

1. adotar o pacote final;
2. habilitar GitHub Actions como origem do Pages;
3. executar CI/Playwright/card-art;
4. fazer um único deploy 1.5.1;
5. iniciar Replay v3 com logs reais;
6. seguir qualidade contínua e produto.

## M2.1 — Account Sync & Import Safety

Status: **CÓDIGO CONCLUÍDO; INSTALAÇÃO DO SUPABASE PENDENTE**.

- sincronização existente endurecida com revisão otimista;
- conflito entre dispositivos não sobrescreve silenciosamente o perfil local;
- snapshot local de conflito preservado;
- schema, função atômica e políticas RLS em
  `supabase/inkwell_profiles.sql`;
- instruções operacionais em `SUPABASE_SETUP.md`;
- estados e mensagens de sync em EN/PT;
- importação de coleção agora abre prévia e não altera dados antes da
  confirmação;
- modo padrão: mesclagem segura pelo maior valor;
- modos adicionais: somar quantidades ou substituir explicitamente;
- snapshot local automático antes de aplicar qualquer importação;
- teste canônico `tools/sync-import-contract.test.mjs` com 8 contratos.

Gate para produção:

1. executar o SQL no painel Supabase;
2. conferir a URL de redirecionamento do GitHub Pages;
3. testar a mesma conta em dois navegadores;
4. executar Playwright após o deploy.


## Visual Replay v2 delta (after deployed release da786668)
Reapplied on top of authoritative commit da786668 as a code-only delta.
- simulateReplay(events,idx): board-state reconstruction — both players' hands (revealed for training), ink total+exerted, drying, exert (90° rotate), damage counters, keyword modifiers active/grey by turn.
- youPlayerOf(match): you=bottom perspective from saved-deck card ownership (state.decks only; no seed decks).
- Fullscreen replay overlay + prev/play/next controls, cleanup via stopReplayTimer.
- exact_board_state:false preserved; imported-log fidelity untouched; Match Center importer/coach/filters/duplicate-protection/legacy unchanged.
- Tests: tools/visual-replay.test.mjs (11 cases). Byte-identical site/index.html ⇄ Inkwell.dc.html.

## Sincronização do working copy com o main (2026-08-05)

O working copy de autoria estava atrasado em relação ao `main`. O `site/index.html`
local era o checkpoint V4-COMPLETE (pré-M2.1) e não continha `mergeCollections`,
prévia de importação nem o compare-and-swap de revisão do sync.

Ação executada: `main` (tree `f2a61d93be4d`) foi trazido para o working copy.

- `site/index.html` e `Inkwell.dc.html` substituídos pela versão M2.1 e verificados
  byte a byte entre si;
- suítes JS faltantes restauradas: `sync-import-contract.test.mjs` e
  `match-center-v5.test.mjs`;
- `package.json`, workflows, `ROADMAP.md`, handoffs M2.1, `SUPABASE_SETUP.md`,
  `supabase/inkwell_profiles.sql` e `docs/INKWELL_PRODUCT_AUDIT_M2_1.md` alinhados;
- nenhum arquivo gerado (`site/data/**`, `data-manifest.json`, imagens, preços,
  dados de usuário) foi tocado;
- nenhum `index.html` criado na raiz.

Correção de defeito encontrada na auditoria: `npm run test:py` apontava para
`tools/test_lorcana_price_agent_daily_v4.py`, que não existe. Corrigido para
`tools/test_ligalorcana_price_agent_daily_v4.py`, o mesmo arquivo que a CI já usa.

`tools/visual-contract.test.mjs` (M3V V1) não existia na CI nem no `test:all`.
Suas 18 asserções foram verificadas contra o `index.html` M2.1 desta sincronização:
18/18 passam (tokens únicos, reduced-motion, focus-ring, alvos de 44 px, guarda de
overflow, paridade EN/PT em 446 chaves, 398 chaves usadas todas presentes, nenhuma
chave crua de portfolio renderizada, espelho byte a byte). A suíte foi promovida
para `npm run test:all` e para o job `js` do `validate.yml`.

Integridade do arquivo confirmada após a cópia: `mergeCollections` na linha 2827,
`mulliganHand` 2699, `simulateReplay` 2931 e `deckHealth` 3471 — as mesmas do
`main`. A diferença de 1.062 bytes contra o GitHub é apenas de fim de linha
(o working copy está todo em LF); nenhum conteúdo foi perdido.

Nada do working copy anterior precisava subir para o `main`: o M2.1 já havia sido
reconciliado sobre o V4 no repositório.

## Limpeza pós-push (2026-08-05)

O push que trouxe a correção do gate também carregou o pacote do price agent v5.
Três arquivos entraram por `git add .` e não deveriam estar versionados — o
próprio `tools/INSTALL_PRICE_AGENT_V5.md` instrui a não commitar o backup:

- `site/data/ligalorcana-prices.before-v5.json` — backup local do cache bruto;
- `tools/__pycache__/ligalorcana_price_agent_daily_v5.cpython-314.pyc` — artefato
  de build;
- `ligalorcana-access-headers.txt` — captura de uma resposta 403 do Cloudflare na
  raiz do repositório. Não contém credenciais (são cabeçalhos de resposta do
  servidor: nonce de CSP e CF-RAY), mas é material de depuração na raiz de deploy.

O repositório não tinha `.gitignore`. Foi criado, cobrindo `__pycache__/`,
`test-results/`, `node_modules/`, `site/data/*.before-*.json` e
`*-access-headers.txt`.

As 11 asserções de `tools/test_ligalorcana_price_agent_daily_v5.py` estavam
versionadas mas fora do `test:py` e do job `python` da CI — a mesma lacuna que o
`visual-contract` tinha. Ambos foram ligados ao gate.

### Estado do refresh de preços

Os artefatos derivados **não** foram republicados neste push: `site/data/prices.json`
e `site/data/price-history.json` não mudaram, e `site/data-manifest.json` continua
consistente com eles (prices sha256 `90f89f83…`, 211.996 bytes, 3.302 IDs com preço).
Mudaram apenas caches intermediários do agente (`ligalorcana-prices.json`,
`card-price-map.json`, `ligalorcana-price-map.v4.json`, `price-analytics.json`),
que não constam do manifesto.

Isso é o comportamento correto do v5: o disjuntor abriu em 401/403 consecutivos e o
agente se recusou a publicar com registros de erro no cache. Consequência prática:
**os preços do site seguem os da validação anterior; o refresh não terminou.**
Rodar `--resume-status` e só publicar quando `remaining_today` for zero e não
houver registros `error`.

## Deploy concluído (2026-08-05)

`tools/visual-contract.test.mjs` foi commitado e a CI ficou verde. M0 a M2.1 estão
publicados. R0.2 fechado.

Retratação: o `0 failed` fixo em `sync-import-contract.test.mjs` não é um gate
decorativo. A suíte usa `node:assert/strict`, cujo throw não é capturado — o node
sai com código diferente de zero e a CI falha. O efeito real é apenas cosmético:
ela para na primeira falha e não imprime resumo. Sem ação necessária.

### Pendências para a próxima sessão

Bloqueio funcional restante:
- ~~rodar `supabase/inkwell_profiles.sql`~~ — feito em 2026-08-05, sync funcionando;
- `git rm --cached` nos 3 arquivos do pacote de limpeza;
- refresh de preços incompleto (disjuntor v5 aberto): rodar `--resume-status`.

Próximo build: M2.2 (Data Health + `import-audit.json`) ou M2.3 (Shared Card Matrix
e caminho inverso card->decks). M2.3 reforça o diferencial; M2.2 fecha o último
risco de perda de dados.

## Sync ativo (2026-08-05)

`inkwell_profiles.sql` executado; o sync responde no ar. M2.1 deixa de estar inerte.

Pendente de confirmação: o teste de aceitação de duas máquinas (item 1d de
`NEXT_STEPS.md`). O caminho felizinho estar funcionando não exercita o
`revision_conflict` — que é justamente a parte que protege a coleção do jogador e
que nunca rodou contra um banco real. Verificar também `rowsecurity = true`: a
chave publishable no `sync-config.json` só é segura com RLS ligado.

## M2.2 — Import Safety & Data Health (2026-08-05)

Entregue no working copy. Escopo confirmado pelo usuário: as três partes.

### Preços nunca bloqueiam o app

Era o defeito mais grave desta área. Em `bootManifest`, um `prices.json` em
formato bruto retornava `{fatal}` e a tela de erro substituía o app inteiro —
coleção, decks, legalidade e partidas ficavam inacessíveis por causa de um preço.
Agora a falha degrada: `priceFailure` recebe `'fetch'`, `'schema'` ou
`'absent'`, os preços aparecem como indisponíveis e todo o resto continua
funcionando. `bootLegacy` segue a mesma postura. `cards.json` continua fatal —
sem cartas não há app.

### Frescor de preços em linguagem de jogador

`priceHealth()` classifica em `fresh` / `stale` / `unavailable` / `unknown`,
com `PRICE_STALE_DAYS = 3`. A tarja âmbar aparece só quando há algo a dizer,
nomeia a data ("Prices are from 2 Aug and may be out of date"), afirma que o resto
está atual, e leva ao painel de detalhes. É dispensável. A view de Preços passa a
mostrar `fonte · as of <data>`.

Isto responde diretamente ao que aconteceu no refresh do v5: os preços estavam
parados e só era possível descobrir lendo o cache do agente. Um jogador não tem
esse acesso.

### Auditoria de importação

`buildImportAudit` produz `inkwell-import-audit/1` com modo de mesclagem, arquivo
de origem, timestamp, contagens (criadas / aumentadas / inalteradas / rejeitadas),
tamanho da coleção antes e depois, `before`/`incoming`/`after` por carta, as
linhas rejeitadas com motivo, e a chave do snapshot de rollback. O download é
oferecido em toda importação: um dry-run na prévia (`-dryrun`, `applied:false`) e
o registro aplicado no painel de resultado que substituiu o toast.

### Linhas não reconhecidas

Os três caminhos de descarte incrementavam um contador. Agora registram
`{where, raw, reason}` — `unknown_id`, `no_match`, `bad_row` — exibidos numa
lista expansível na prévia e incluídos na auditoria. A importação não é bloqueada:
o resto entra e as linhas ignoradas ficam para revisão.

### Saúde dos dados

Painel sempre visível em Ajustes com três linhas em linguagem simples (preços,
cartas no banco, cartas na coleção). O relatório do pipeline — hashes, erros,
warnings — fica atrás de "Detalhes técnicos", recolhido por padrão.

### Verificação

- `tools/data-health-contract.test.mjs`, nova, 26 asserções, 26/26 executadas
  neste ambiente (a lógica foi extraída do `index.html` e executada de fato:
  classificação de frescor nos limites, matemática do audit, imutabilidade das
  coleções, cobertura dos caminhos de rejeição);
- `visual-contract` 18/18, incluindo paridade EN/PT agora em 472 chaves;
- espelho `Inkwell.dc.html` byte a byte;
- `sc-if` 118/118 e `sc-for` 85/85 balanceados; contrato M2.1 intacto
  (CAS de revisão, snapshot pré-importação, prévia antes de mutação).

Não executado aqui (sem runner): `npm run test:all`, `test:py`, Playwright,
`validate_release.py`.

Nenhum dado gerado foi tocado.

### O que M2.2 não inclui

O painel de saúde relata o que o app consegue observar do lado do cliente. Não
expõe estado do agente de preços (disjuntor, `remaining_today`) — isso vive na
máquina que roda o agente, não no navegador. Se quiser isso visível no site, o
agente precisa publicar um pequeno artefato de status no `data-manifest`.

## M2.2 no ar (2026-08-05)

Publicado. `site/index.html` e `Inkwell.dc.html` no `main` com os mesmos offsets
(1850, 2273, 2965, 2984), `package.json` e `validate.yml` com as duas suítes novas.

Observação de manutenção: o script legado `test:js` do `package.json` é um
agregado antigo e não inclui `deck-portfolio-v4`, `match-center-v5`, `i18n`,
`visual-replay`, `visual-contract`, `sync-import` nem `data-health`. Quem rodar
`test:js` esperando cobertura total recebe um verde enganoso. A CI e o `test:all`
estão corretos. Sugestão: apagar `test:js` ou apontá-lo para `test:all`.

### Pendências

- `git rm --cached` nos 3 arquivos (se ainda não feito);
- refresh de preços incompleto: `--resume-status`;
- teste de conflito de revisão (item 1d de `NEXT_STEPS.md`, 30 s no SQL Editor);
- próximo build: M2.3 (Shared Card Matrix + caminho inverso carta→decks).

## Deploy desacoplado dos checks (2026-08-05)

A pedido, com a confirmação de que ninguém externo está acessando o site.

`deploy-pages.yml` passa a disparar em `push` para `main` em vez de esperar a
conclusão de "Inkwell release checks". O gate `workflow_run` e a condição
`conclusion == 'success'` ficaram comentados no próprio arquivo para reversão
imediata.

O workflow de checks continua rodando e reportando — só não bloqueia mais.

Mantido de propósito: o passo **Verify deploy root**. Não é suíte de teste; é a
guarda contra publicar uma raiz estruturalmente quebrada (`site/index.html`,
`support.js`, `data-manifest.json` presentes e nenhum `index.html` na raiz) e
custa nada.

Também removido o script legado `test:js` do `package.json`, que era um agregado
antigo cobrindo 9 de 16 suítes e dava verde enganoso.

### Divergência resolvida

`test:all` passou de 14 para 16 suítes, idêntico ao job `js` da CI:
`match-center-r3.test.mjs` e `match-center-legacy-core.test.cjs` foram
adicionadas. Com o deploy desacoplado o verde local é a única coisa olhada antes
de publicar, então ele precisa ser igual ao da CI, não mais fraco.

Adicionado `npm run verify` = `test:all` + `test:py` + `validate`. Um comando
antes de commitar.

### Ao voltar a ter usuários

Restaurar o gate antes de abrir para qualquer pessoa de fora. Enquanto estiver
desacoplado, um push com regressão vai ao ar em segundos e a CI só avisa depois.

## M2.3 — Shared Cards & Portfolio UX (2026-08-05)

Entregue no working copy. Formato escolhido pelo usuário: deck-first, todas as
cartas de cada deck, contestadas destacadas, dentro da view de Decks, com
recomendação de para qual deck as cópias devem ir.

### Bug do overview corrigido primeiro

Relato do usuário: "in overview it does not show all decks". Causa encontrada na
linha do card **Now Playing**: `others: st.decks.filter(...).slice(0,4)` — o
seletor "Switch deck" cortava em 4 silenciosamente, sem indicar que havia mais.
Com 5+ decks, os excedentes simplesmente não existiam na interface. O `slice`
foi removido; a lista mostra todos os outros decks.

### Motor

`sharedMatrix()` lê a alocação do próprio otimizador (`cardAllocations`) em vez
de recalcular a disputa — a mesma disciplina do V4. Por deck devolve todas as
cartas com cópias possuídas, necessidade, alocado, faltante, demanda total entre
decks, se é contestada, se é escassa, os concorrentes e a recomendação.

Recomendação apenas quando há disputa real (demanda > estoque). O deck escolhido
é o que o plano de fato favorece, e o motivo é derivado do estado do plano:
prioridade fixada, fecha com estas cópias, completa de imediato, ou precisa de
menos cópias. Onde há cópias para todos, nenhuma recomendação é dada — não existe
decisão a tomar.

### Caminho inverso

Decisão minha (o usuário deixou em aberto): cada carta contestada é um botão na
lista do deck; abrir mostra os decks concorrentes com alocado/necessário e a
recomendação. Não usei tooltip — em toque não existe hover, e a informação é
densa demais para caber em um.

Padrão: um deck aberto por vez e uma carta aberta por vez, para não montar
centenas de linhas no DOM. Por padrão a lista mostra só as compartilhadas;
"Ver todas as cartas" abre o inventário completo do deck.

### Verificação

- `tools/shared-cards-contract.test.mjs`, nova, 23 asserções, 23/23 executadas
  aqui (motor extraído por casamento de chaves e executado de verdade com o
  otimizador real): disputa 4 vs 4 aloca exatamente 4 e deixa um deck curto,
  prioridade fixada muda o recomendado, compartilhada com estoque suficiente
  nunca vira curta nem gera recomendação, decks homônimos ficam distinguíveis,
  reprints fundem numa identidade, ordenação põe faltantes no topo;
- `visual-contract` 18/18, paridade EN/PT em 490 chaves;
- espelho byte a byte; `sc-if` 124/124, `sc-for` 88/88;
- `test:all` e o job `js` da CI em 17 suítes cada, sem divergência.

Não executado aqui: `npm run verify` e Playwright.

## M2.4 — Meta-to-Collection Advisor (2026-08-05)

Entregue no working copy, dentro da view de Decks, conforme escolhido.

### Restrição encontrada nos dados, antes de construir

`site/data/meta-decks.json` não contém nenhum dado de torneio. São 3 listas, todas
`source_type: "community_popular"`, com `tournament_result: null`, confiança
0,61–0,66 rotulada `community_reference` e as três marcadas
`work_in_progress: true`. A própria política do arquivo diz: sinal de
popularidade, não prova de torneio.

Então a seção não usa linguagem de tier nem "melhores decks". Chama-se "Listas
populares da comunidade", e um aviso fixo declara que não há resultados de torneio
nestes dados. O aviso só desaparece se algum deck passar a ter
`tournament_result` — há teste para isso.

O arquivo também não está no `data-manifest.json`, portanto não é verificado por
checksum como os outros artefatos. É carregado como opcional e nunca fatal, por
dois caminhos (`data/meta-decks.json` e `meta-decks.json`), sem `loadArtifact`.

### O que a seção faz

Cobertura por lista contra a coleção real (reprints somados por identidade, foils
contam, posse acima do exigido não infla a porcentagem), custo para completar com
os preços do próprio app, contagem de cartas sem preço em vez de tratá-las como
zero, sobreposição com o deck do usuário que mais compartilha cartas, e a lista do
que falta com custo por linha.

Substituições saem apenas de cartas que o usuário possui, casando ink, custo e
tipo, no máximo duas por carta, com a ressalva visível de que não são equivalentes
de estratégia. Sem candidata possuída, nenhuma sugestão — melhor vazio que chute.

### Decisões que ficaram comigo

**Ação:** somente adicionar as faltantes à lista de desejos. Copiar uma lista para
os decks do usuário criaria um deck que ele não montou e que entraria no
otimizador de portfólio — mudaria silenciosamente o plano do Advisor e a matriz de
cartas compartilhadas do M2.3. A wishlist é reversível e não afeta cálculo nenhum.
Nunca remove entradas existentes.

**WIP:** exibidos, com selo "em construção". Esconder 3 de 3 listas deixaria a
seção vazia.

### Bug de i18n encontrado no caminho

Valores em inglês como `'How to play:'` e `'You own instead:'` fazem o extrator de
chaves das suítes de i18n interpretar `play` e `instead` como chaves do dicionário,
gerando falha falsa de paridade EN/PT. Os rótulos passaram a não ter dois-pontos
internos (o template já os apresenta como cabeçalho). Vale como regra ao adicionar
strings: não usar `palavra:` dentro de um valor.

### Verificação

- `tools/meta-advisor-contract.test.mjs`, nova, 32 asserções, 32/32 executadas
  aqui com o motor extraído e rodado de verdade;
- `shared-cards` 23/23 e `data-health` 26/26 reexecutadas sem regressão;
- `visual-contract` 18/18, paridade EN/PT em 512 chaves;
- espelho byte a byte; `sc-if` 132/132, `sc-for` 91/91;
- `test:all` e CI em 18 suítes cada, sem divergência.

Não executado aqui: `npm run verify` e Playwright.

### Limite honesto desta entrega

Não há ingestão semanal automática. O dataset é um seed manual de 29/07. Para o
M2.4 completo como descrito na auditoria, falta um agente que atualize o arquivo
e o registre no `data-manifest.json` — aí a seção passa a ter frescor verificável,
como os preços têm hoje.
