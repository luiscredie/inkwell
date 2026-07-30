# Inkwell — Auditoria de Produto após M2.0

Data: 29 de julho de 2026  
Baseline: M2.0 Replay Fidelity v3, verificado localmente  
Foco: jogador iniciante e intermediário de Disney Lorcana

## Resumo executivo

O Inkwell não deve tentar ser apenas outro catálogo de cartas ou construtor de
decks. Dreamborn.ink já ocupa muito bem esse espaço; InkDecks concentra dados de
torneios e metagame; Duels.ink oferece o ambiente de prática.

A oportunidade defensável do Inkwell é:

> **Transformar a coleção real do jogador em decks jogáveis, um plano de compras
> eficiente e treinamento personalizado baseado nas partidas.**

O produto já possui as fundações necessárias: coleção por impressão, decks por
usuário, alocação simultânea de cartas, preços brasileiros, Match Center,
importação de logs, coach e replay visual. Agora a prioridade deve deixar de ser
“acrescentar telas” e passar a ser “conectar essas capacidades em decisões
claras para o jogador”.

## Comparação de mercado

| Capacidade | Dreamborn.ink | InkDecks | Duels.ink | Inkwell |
|---|---:|---:|---:|---:|
| Catálogo e busca | Forte | Forte | Médio | Forte |
| Deck builder | Muito forte | Médio | Forte | Forte |
| Decks comunitários | Muito forte | Médio | Fraco | Inicial |
| Resultados competitivos | Fraco | Muito forte | Ranked próprio | Inicial |
| Coleção pessoal | Forte | Fraco | Coleção virtual | Forte |
| Compatibilidade coleção × deck | Parcial | Fraco | Não é o foco | Forte |
| Otimização de vários decks | Fraco | Fraco | Fraco | Diferencial |
| Preços no Brasil | Fraco | USD | Não é o foco | Diferencial |
| Simulação de partidas | Não | Não | Muito forte | Replay de logs |
| Coach pós-partida | Não | Não | Limitado | Diferencial |
| Português | Limitado | Limitado | Limitado | Diferencial |
| Trilha para iniciantes | Limitada | Limitada | Aprende jogando | Em desenvolvimento |

Fontes públicas consultadas:

- Dreamborn apresenta criação, descoberta de milhares de decks, coleção e
  escaneamento pelo Companion App:
  https://dreamborn.ink/
- InkDecks oferece resultados de torneios, metashare, win rate, preço,
  classificação de tiers e matriz de matchups:
  https://inkdecks.com/lorcana-metagame
- Duels.ink possui jogo contra bots e pessoas, filas ranqueadas, formatos Core,
  Infinity, Sealed e Pack Rush, além de logs detalhados:
  https://duels.ink/release-notes

## Problemas prioritários encontrados

### P0 — Decks e partidas não acompanham o usuário entre dispositivos

Hoje os dados pessoais dependem do armazenamento local do navegador. Abrir o
site em outro computador ou celular cria uma experiência vazia, e limpar os
dados do navegador pode apagar o histórico local.

Isso afeta diretamente as partes mais valiosas do produto:

- decks salvos;
- partidas e logs importados;
- replay e análises;
- coleção e wishlist;
- deck ativo;
- progresso de aprendizado;
- prioridades do Portfolio Advisor.

**Correção necessária**

- autenticação simples e opcional;
- sincronização automática entre dispositivos;
- funcionamento offline com fila de alterações;
- versionamento e restauração;
- indicador claro: “salvo localmente”, “sincronizando”, “sincronizado” ou
  “conflito”;
- proteção contra sobrescrever dados mais novos;
- botão “Sincronizar agora”;
- exportação completa independente do servidor.

O frontend já possui autenticação por magic link e cliente Supabase. Portanto,
o caminho eficiente não é introduzir outro backend: é concluir e endurecer a
infraestrutura existente com tabela versionada, RLS e gravação atômica.

> **GitHub Pages + Supabase Auth/Postgres**, com RLS por `auth.uid()` e controle
> de revisão por perfil.

Para a primeira entrega, não é necessário normalizar todo o domínio em dezenas
de tabelas. Um snapshot JSON versionado por usuário reduz o risco:

```text
user_id
schema_version
revision
payload
updated_at
device_id
```

O `payload` contém coleção, decks, partidas, wishlist, progresso, overrides e
deck ativo. O cliente envia a revisão conhecida; o servidor só grava se ela
continuar atual. Em caso de conflito, a gravação é recusada e a versão local é
preservada num snapshot de conflito.

**Implementado no delta M2.1:** `supabase/inkwell_profiles.sql`,
`SUPABASE_SETUP.md`, revisão otimista no frontend e mensagens EN/PT. A ativação
em produção depende apenas da execução do SQL pelo administrador do projeto.

### P0 — Importação de coleção é destrutiva e pouco transparente

O código atual cria uma nova coleção durante a importação e substitui a coleção
do perfil. Isso explica a percepção de que algumas cartas “sumiram”.

**Correção necessária**

- Exibir uma tela de prévia antes de aplicar.
- Oferecer três modos explícitos:
  - **Mesclar e somar**;
  - **Mesclar e manter o maior valor**;
  - **Substituir toda a coleção**.
- “Substituir” deve exigir confirmação clara.
- Mostrar: linhas lidas, impressões reconhecidas, cópias normais, foils,
  promoções, não reconhecidas e alterações finais.
- Permitir baixar `import-audit.json`.
- Criar snapshot automático recuperável antes de qualquer substituição.

**Implementado no delta M2.1:** prévia, mesclagem segura como padrão, soma,
substituição explícita e snapshot local antes de aplicar. O download separado
de `import-audit.json` permanece como melhoria incremental.

### P0 — Confiança nos dados ainda aparece como problema do usuário

Checksums e schema são importantes, mas mensagens técnicas não ajudam o
jogador. A interface deve traduzir falhas em ação.

**Correção necessária**

- Trocar avisos técnicos por “Os preços podem estar desatualizados”.
- Incluir botão “Ver diagnóstico”.
- Mostrar por artefato: atualizado, antigo, ausente ou incompatível.
- Nunca bloquear coleção/decks por falha apenas em preços.
- Guardar a última versão válida como fallback.

### P1 — O Card Advisor ainda não explica conflitos entre decks

O otimizador calcula alocação, mas a interface precisa responder:

- Em quais decks esta carta aparece?
- Quantas cópias físicas existem?
- Quantas estão comprometidas em cada deck?
- Qual deck ficou completo por causa dessa alocação?
- Qual deck perdeu prioridade?
- Qual compra libera mais decks?

**Solução recomendada: Shared Card Matrix**

Uma tabela por carta compartilhada:

| Carta | Tenho | Deck A | Deck B | Deck C | Déficit | Ação |
|---|---:|---:|---:|---:|---:|---|
| Exemplo | 4 | 4 | 2 | 0 | 2 | Comprar 2 ou reduzir B |

Também deve existir o caminho inverso: dentro de um deck, clicar em uma carta
mostra todos os outros decks que disputam aquelas cópias.

### P1 — O Advisor fala em números, mas não oferece uma decisão

Substituir rótulos internos como `portfolioHead` e `portfolioMissing` por frases
orientadas à ação:

- “Você consegue montar 3 decks ao mesmo tempo.”
- “Faltam 7 cópias para completar os outros 2.”
- “Comprar 1 carta completa este deck.”
- “Estas 4 cartas são compartilhadas por mais de um deck.”
- “Priorizar este deck impede a montagem de dois outros.”

### P1 — Meta decks ainda são dados isolados

`meta-decks.json` só terá valor quando estiver conectado à coleção e ao Advisor.

Cada sugestão deve mostrar:

- formato e legalidade;
- data e fonte;
- tier, metashare, win rate e tamanho da amostra, quando disponíveis;
- confiança: torneio, ranked ou popularidade comunitária;
- cartas que o usuário possui;
- cartas faltantes;
- custo estimado para completar;
- conflitos com decks já montados;
- dificuldade;
- plano de jogo e mulligan;
- matchups favoráveis e desfavoráveis;
- alternativas usando cartas da coleção.

Não misturar popularidade do Dreamborn com resultado competitivo. A evidência
deve sempre permanecer visível.

### P1 — Tradução precisa de controle de qualidade contextual

Ter EN/PT não garante boa tradução. Nomes de palavras-chave, terminologia
oficial e relações entre habilidades precisam ser consistentes.

**Adicionar**

- glossário canônico EN → PT;
- validação automática de termos;
- relatório de cartas com fallback em inglês;
- botão “Ver original em inglês”;
- feedback “Tradução confusa/incorreta” por carta;
- exemplos de resolução para habilidades complexas, separados da tradução
  literal.

### P2 — Replay é tecnicamente forte, mas precisa ensinar

O Replay v3 deve evoluir de reprodução para treinamento.

**Adicionar**

- marcadores de decisão: mulligan, tinta, canto, desafio, quest e passe;
- “Ponto de revisão” nos turnos de maior impacto;
- comparação entre plano declarado do deck e ações executadas;
- filtro “mostrar apenas decisões”;
- resumo “3 momentos para rever”;
- grau de confiança por insight;
- nunca afirmar estado de mesa que não esteja no log.

### P2 — Falta um ciclo de prática

Depois da análise, o produto deve recomendar uma ação mensurável:

- “Jogue 3 partidas focando em não colocar seus finalizadores na tinta.”
- “Teste 10 mãos iniciais e procure pelo menos duas jogadas até o turno 3.”
- “Revise partidas contra Amber/Emerald.”
- “Treine quando desafiar em vez de aventurar.”

O progresso pode ser acompanhado por objetivo, sem transformar o produto em
um simulador completo.

## Novas funcionalidades recomendadas

### 1. “O que posso jogar hoje?”

Home orientada à decisão:

1. decks completos agora;
2. decks a uma compra de distância;
3. melhor deck para o meta atual;
4. deck recomendado para aprender;
5. deck ativo e próximo treino.

### 2. Compra que desbloqueia mais

Em vez de somente wishlist:

- calcular quantos decks cada compra completa;
- ordenar por decks desbloqueados, custo e prioridade;
- comparar “comprar 1 carta cara” com “comprar 4 cartas baratas”;
- permitir travar cartas que o usuário não quer comprar.

### 3. Substituições inteligentes

Para cada carta faltante:

- sugerir cartas da coleção com função semelhante;
- comparar custo, tipo, inkability, força, vontade e lore;
- explicar o que se perde e o que se ganha;
- marcar a substituição como casual, competitiva ou experimental.

### 4. Meta semanal com contexto

Pipeline semanal:

- coletar resultados com data, evento, jogadores e colocação;
- agrupar por arquétipo;
- identificar subida/queda de participação e win rate;
- guardar snapshots históricos;
- publicar apenas listas Core legais;
- mostrar “mudou desde a semana passada”;
- cruzar cada arquétipo com a coleção do usuário.

### 5. Matchup Notebook

Por deck e arquétipo adversário:

- plano pré-jogo;
- cartas-chave;
- prioridades de mulligan;
- ameaças a responder;
- condição de vitória;
- anotações pessoais;
- recorde real das partidas importadas.

### 6. Laboratório de mulligan

- gerar mãos usando o deck salvo;
- permitir manter/trocar cartas;
- pontuar pela estratégia e pelos papéis definidos no M1.9;
- acompanhar consistência de curva;
- ensinar o motivo, não apenas dar uma nota.

### 7. Trilha guiada para iniciantes

Uma sequência curta e prática:

1. objetivo e zonas;
2. tinta e inkability;
3. quest versus challenge;
4. songs e singing;
5. curva e mulligan;
6. montar o primeiro deck;
7. registrar e revisar a primeira partida.

Usar cartas do deck ativo do usuário nos exemplos.

### 8. Preparação para evento

Checklist gerado a partir do deck:

- legalidade e cartas banidas;
- 60+ cartas e máximo de quatro cópias;
- sleeves/tokens/damage counters;
- lista exportável;
- matchups para revisar;
- metas de treino da semana.

### 9. Sincronização e recuperação

LocalStorage é adequado como cache offline, não como fonte única da verdade.

- conta opcional e identidade estável;
- backend autenticado;
- sincronização de coleção, decks, partidas e preferências;
- fila offline e retomada automática;
- detecção de conflito por revisão;
- backup automático versionado no servidor;
- exportação completa;
- restauração seletiva;
- indicador claro “salvo neste dispositivo” versus “sincronizado”.

### 10. Scanner móvel

Dreamborn já oferece escaneamento. Para paridade futura:

- câmera ou upload de foto;
- confirmação de set, número e variante;
- fila de itens incertos;
- nunca aplicar reconhecimentos ambíguos automaticamente.

## Arquitetura e qualidade

### Reduzir o risco do HTML monolítico

O arquivo único facilitou o desenvolvimento inicial, mas agora aumenta risco de
regressão e custo de manutenção.

Extrair gradualmente, sem reescrever tudo:

1. `collection-import.js`;
2. `deck-portfolio.js`;
3. `meta-advisor.js`;
4. `match-center-ui.js`;
5. `replay-ui.js`;
6. `i18n.js`.

Manter testes de contrato antes de cada extração.

### Acessibilidade

- dialogs com `role="dialog"`, nome acessível e foco preso;
- retorno do foco ao elemento que abriu o modal;
- navegação completa por teclado;
- estados não comunicados apenas por cor;
- tamanho de toque adequado no mobile;
- opção para reduzir animações.

### Performance

- virtualização ou paginação consistente;
- lazy-load real de imagens e overlays PT;
- cancelar requisições de pesquisa antigas;
- cache versionado de dados;
- desativar efeitos visuais pesados em aparelhos lentos;
- medir LCP, INP e erros reais de carregamento.

## Revisão de design: referência visual, efeitos e conteúdo

### Direção criativa

O produto deve parecer um **codex de estratégia contemporâneo**, não uma
planilha de coleção e nem uma cópia visual dos concorrentes.

A identidade recomendada combina:

- tinta, papel iluminado e detalhes dourados como assinatura;
- estrutura limpa de produto esportivo/analítico;
- card art como principal elemento visual;
- dados densos apresentados em camadas;
- animações discretas que reforçam ação e estado.

O dourado deve indicar hierarquia e conquista, não aparecer em todos os
contornos. Roxo e preto podem sustentar a marca; verde, vermelho e azul ficam
reservados para estados e dados.

### Sistema visual

- definir tokens de cor, superfície, borda, sombra, raio, tipografia, espaço e
  movimento;
- limitar a duas famílias tipográficas;
- criar escala tipográfica consistente;
- criar componentes canônicos para cards, métricas, filtros, tabelas, dialogs,
  empty states, alertas, tooltips e skeletons;
- reduzir combinações arbitrárias de estilos inline;
- usar densidade confortável no mobile e compacta opcional no desktop.

### Hierarquia por página

Toda página precisa responder, nesta ordem:

1. **Onde estou?**
2. **O que importa agora?**
3. **Qual ação devo executar?**
4. **Onde vejo detalhes?**

Exemplos:

- Overview: próximo passo de jogo antes de métricas financeiras;
- Decks: decks montáveis, conflitos e progresso antes da lista completa;
- Matches: desempenho e aprendizado antes do arquivo histórico;
- Prices: movimento relevante antes de valor total;
- Learn: próxima lição antes do catálogo de conteúdo.

### Efeitos e movimento

Animação deve comunicar, não decorar.

- microinterações: 120–180 ms;
- transições de painel/modal: 180–260 ms;
- entrada de página: no máximo 300 ms;
- animação de alocação para mostrar uma carta sendo comprometida em um deck;
- destaque breve ao completar um deck;
- transição de estado no replay;
- skeletons durante carregamento;
- shimmer e partículas apenas em momentos raros;
- respeitar `prefers-reduced-motion`;
- desativar efeitos pesados automaticamente em dispositivos lentos.

Evitar fundos permanentemente animados, blur excessivo, múltiplos glows,
parallax e efeitos que competem com a arte das cartas.

### Conteúdo primoroso

Qualidade de conteúdo é parte do design.

Cada recomendação deve conter:

- conclusão curta;
- motivo;
- evidência ou fonte;
- confiança;
- próxima ação;
- data de atualização.

Os textos precisam adotar linguagem consistente:

- “aventurar”, “desafiar”, “tinta”, “tintável”, “força”, “vontade” e “lore”;
- nunca expor chaves internas;
- evitar mensagens técnicas na superfície principal;
- explicar termos no contexto, sem obrigar o jogador a abrir o glossário;
- oferecer EN original quando a tradução de carta estiver em dúvida.

### Experiência mobile

- navegação inferior ou rail compacto com ações principais ao alcance;
- filtros em bottom sheet;
- cards com informações progressivas;
- ações persistentes no deck builder;
- tabelas transformadas em cartões comparáveis;
- replay com orientação e zoom adequados;
- alvos de toque de pelo menos 44 px;
- nenhuma função importante dependente de hover.

### Metas objetivas de qualidade

- LCP abaixo de 2,5 s;
- INP abaixo de 200 ms;
- CLS abaixo de 0,1;
- zero erro fatal em troca de perfil ou dispositivo;
- zero modal sem foco e nome acessível;
- contraste WCAG AA;
- 100% das ações principais utilizáveis por teclado;
- nenhuma chave de tradução visível;
- nenhuma perda silenciosa de dados;
- card art abaixo da dobra carregada sob demanda;
- opção de movimento reduzido funcionando.

## Roadmap recomendado

### M2.1 — Account Sync & Data Continuity

**Objetivo:** fazer os dados pessoais acompanharem o usuário com segurança.

- autenticação simples;
- API de sync;
- snapshot versionado por usuário;
- migração inicial do localStorage;
- cache offline;
- conflito sem perda;
- estados visuais de sincronização;
- restauração de versões;
- testes com dois dispositivos e edição simultânea.

### M2.2 — Import Safety & Data Health

**Objetivo:** eliminar perda de dados e mensagens incompreensíveis.

- import preview;
- merge/replace explícito;
- snapshot e undo;
- relatório de não reconhecidas;
- Data Health orientado ao usuário;
- testes com promos, reprints, normal/foil e coleções existentes.

### M2.3 — Shared Cards & Portfolio UX

**Objetivo:** tornar o otimizador compreensível.

- Shared Card Matrix;
- alocação por deck;
- explicações humanas;
- prioridade visual;
- simulação “e se?” sem alterar os decks;
- plano de montagem simultânea.

### M2.4 — Meta-to-Collection Advisor

**Objetivo:** transformar meta decks em decisões pessoais.

- ingestão semanal com evidência;
- cobertura da coleção;
- custo para completar;
- legalidade;
- dificuldade e guia;
- substituições;
- “compra que desbloqueia mais”.

### M2.5 — Practice Loop

**Objetivo:** converter análise em melhoria.

- pontos de decisão do replay;
- exercícios;
- Matchup Notebook;
- laboratório de mulligan;
- metas semanais.

### M2.6 — Beginner Journey & Content

**Objetivo:** levar um iniciante da coleção à primeira revisão de partida.

- onboarding;
- trilha contextual;
- primeiro deck;
- primeira partida;
- glossário e links contextuais.

### M2.7 — Visual Excellence & Performance

**Objetivo:** transformar o Inkwell em referência visual sem sacrificar
velocidade ou acessibilidade.

- design tokens;
- biblioteca interna de componentes;
- revisão completa mobile;
- hierarquia e conteúdo por página;
- motion system;
- skeletons e estados vazios;
- acessibilidade AA;
- budgets de performance;
- testes visuais e de viewport;
- extração gradual de estilos inline.

Esta frente deve começar com os tokens em paralelo ao M2.1, mas a reformulação
completa vem depois que persistência e importação estiverem seguras.

### M3 — Platform & Scale

- PWA/offline;
- scanner;
- módulos extraídos;
- telemetria de erros e performance respeitando privacidade.

## Ordem recomendada

1. **M2.1**, porque decks e partidas precisam acompanhar o usuário.
2. **M2.2**, porque importação nunca pode remover dados sem confirmação.
3. **M2.3**, porque o Advisor é o principal diferencial existente, mas ainda não
   comunica bem seu valor.
4. **M2.4**, conectando `meta-decks.json` à coleção.
5. **M2.5**, aproveitando o investimento no Replay v3.
6. **M2.6**, consolidando aquisição e retenção de iniciantes.
7. **M2.7**, com tokens iniciados antes e refinamento visual completo após os
   fluxos críticos.
8. **M3**, depois que os fluxos principais estiverem comprovados.

## Métricas recomendadas

- percentual de importações com zero não reconhecidas;
- recuperações por snapshot;
- decks completos simultaneamente;
- cartas compartilhadas resolvidas pelo usuário;
- decks desbloqueados por compra;
- meta deck aberto → salvo/adaptado;
- partida importada → replay revisado;
- exercício recomendado → concluído;
- iniciante que conclui primeiro deck e primeira partida;
- uso EN/PT e taxa de fallback de tradução.

## Conclusão

O Inkwell já tem mais profundidade individual que muitos projetos pequenos, mas
essa profundidade ainda aparece como ferramentas separadas. O próximo salto não
é construir mais um módulo isolado: é formar uma jornada contínua:

> **Minha coleção → meus decks possíveis → melhor escolha para hoje → plano de
> compras → partida → replay → aprendizado → próximo treino.**

Essa jornada, com preços brasileiros e português de qualidade, é a posição mais
forte e distinta para o produto.
