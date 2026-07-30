# Inkwell — Roadmap reconciliado

Atualizado em 2026-07-28. Raiz canônica de publicação: `site/`.
Entrada canônica: `site/index.html`. `Inkwell.dc.html` é apenas um espelho
byte a byte para desenvolvimento.

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
