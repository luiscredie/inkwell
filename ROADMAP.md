# Inkwell — Roadmap reconciliado

Atualizado em 2026-07-28. Raiz canônica de publicação: `site/`.
Entrada canônica: `site/index.html`. `Inkwell.dc.html` é apenas um espelho
byte a byte para desenvolvimento.

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
