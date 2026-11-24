# Scanner contínuo: melhoria de experiência (uma carta por vez)

Status: **PR draft, sem publicação.** É uma melhoria do scanner de uma carta que já existe, independente do "Escanear página" (#324). O reconhecimento não mudou.

## Origem

O Conselho analisou (24/11) uma demonstração do Evolens no modo Single: o celular fica parado e as cartas passam uma após a outra. Cada reconhecimento mostra uma miniatura, soma o valor e conta as cartas para revisão. **Não é** reconhecimento simultâneo de página.

## O que muda

| Pedido do Conselho | Como ficou |
|---|---|
| 1. Preservar o reconhecimento contínuo | Mesmo motor, mesmos limiares, mesma espera até a carta sair do quadro. A suíte da Coleção (88 testes) passa. |
| 2. Faixa discreta de miniaturas | Abaixo da última carta, as últimas 12 da sessão, a mais recente primeiro e destacada; as demais aparecem como "+N". Nada ali exige toque. |
| 3. Contador e valor acumulado | "20 na lista · ≈ R$ 719,97", com os preços já carregados na página (o mesmo `priceOf` da Coleção). Avisos entre parênteses: "N sem preço", "N foil estimados" (preço foil calculado a partir do normal), "preços de 5 de jan., desatualizados" e "preços indisponíveis", estes em cor de alerta. Usa o mesmo critério de desatualização do site (`INKWELL_PRICE_NOTE`). |
| 4. Sem toques obrigatórios entre cartas | A carta entra sozinha ao ficar estável, como antes. Ver "Achados" sobre as reimpressões. |
| 5. Sessão de 20 cartas, com repetidas e foils | `tools/scan-session.spec.mjs` (medições abaixo). |
| 6. Comparar com a Página 3×3, mantendo independentes | Seção "Comparação". Nenhum código compartilhado foi tocado. |
| 7. Confirmação final e proteção contra duplicação | Nada é gravado antes de "Adicionar N cartas" na revisão. Duas cópias seguidas contam duas; uma carta parada no quadro conta uma. Isso é coberto pelo teste: zero gravações durante a sessão e, depois, uma gravação igual à lista. |

## Medições (Chromium desktop, câmera falsa, 24/11)

Sessão de 20 passagens (16 cartas diferentes):
- passagem 6 é uma segunda cópia logo após a 5;
- passagens 13, 18 e 20 repetem cartas vistas antes;
- passagens 4, 9, 15 e 20 são foil, com brilho arco-íris desenhado;
- a carta entra no quadro com leve desalinhamento de mão; entre uma carta e outra, 0,6 s sem carta.

O OCR da linha de colecionador decide entre impressões com a mesma arte. Neste ambiente o Tesseract não pode ser baixado, então o teste usa uma leitura correta simulada ("OCR simulado"); no celular o OCR real é baixado do CDN, e o tempo dele não foi medido aqui.

| Cenário | Certas | Erradas | Duplicadas | Perdidas | Toques | Latência mediana (máx.) |
|---|---|---|---|---|---|---|
| Carta 2,2 s no quadro, OCR simulado | **20/20** | 0 | 0 | 0 | **0** | 1,42 s (1,49 s) |
| Carta 1,6 s no quadro, OCR simulado | 18/20 | 0 | 0 | 2 | 0 | 1,40 s (1,54 s) |
| Carta 2,2 s no quadro, **sem OCR** | 15/20 | 0 | 0 | 5 | 1 | 1,41 s (1,75 s) |

- **No CI** (máquina compartilhada, 24/11): 19/20 na mesma sessão de 2,2 s. A segunda de duas cópias seguidas não foi lida, nenhuma errada, nenhuma duplicada. Por isso o teste exige só as garantias (0 erradas, 0 duplicadas, ≥ 18/20) e registra o ritmo como medição.
- **Ritmo:** cada carta leva ~1,4 s para entrar (3 leituras estáveis a cada 350 ms, mais o processamento). Com 2,2 s por carta mais 0,6 s de troca, 20 cartas levam 56 s. Com 1,6 s, a segunda de duas cópias seguidas às vezes não é lida, porque o scanner primeiro espera a anterior sair do quadro.
- **Foil:** as 4 foram identificadas, mas **0 de 4 foram marcadas como foil**. O scanner não distingue foil de normal: a pessoa alterna "Normal/Foil" no topo ou corrige na revisão.
- **Avisos de preço:** testados com um arquivo de preços antigo e uma carta sem preço. A tela mostra "1 sem preço" e "desatualizados" em cor de alerta.

## Achados (sem mudança neste PR)

1. **Reimpressões quando o OCR falha.** Com a mesma arte em duas impressões (por exemplo, Elsa LOR11-125 e LOR11-215), sem OCR a carta não entra. O scanner tenta 3 vezes, e a pergunta "qual destas?" só aparece se a carta continuar no quadro. Na sessão sem OCR, 5 cartas foram perdidas assim, e 1 pergunta exigiu toque. Isso também vale para celular com OCR lento, sem rede ou com a linha ilegível.
   **Proposta:** pôr a carta na lista como "impressão a escolher" e resolver na revisão. Não exige toque durante a sessão e mantém a confirmação final.
2. **Foil manual.** Proposta: lembrar o último estado de "Foil" por sessão (já acontece) e, na revisão, um atalho "marcar foils" por miniatura. Detecção automática de foil é pesquisa à parte.
3. **Ritmo.** Aceitar a carta com 2 leituras estáveis em vez de 3 cortaria ~0,35 s, mas aumenta o risco de pegar a carta em movimento. Só testar com medição em celular real.

## Comparação com a Página 3×3 (#324)

| | Contínuo (uma por vez) | Página 3×3 |
|---|---|---|
| Gesto | Passar cartas sob o celular parado | Fotografar uma página inteira do fichário |
| Melhor para | Cartas soltas, pilhas, abrir boosters | Coleção já organizada em fichário |
| Tempo medido (desktop) | ~2,8 s por carta na sessão (1,4 s de reconhecimento + troca de carta) | 1,3 s de processamento por página de 9 (~0,15 s por carta), mais o tempo de montar, fotografar e conferir a página (não medido) |
| Ação da pessoa | 0 toques na sessão com OCR funcionando | 34% das posições pedem decisão (no sintético: impressões, confirmações) |
| Precisão medida | 20/20 na câmera falsa (cartas limpas e foils simuladas) | 90,1% de identificação em fotos sintéticas com dano controlado |
| Dados | Câmera falsa no navegador | Fotos sintéticas |

**Os números não são comparáveis entre si como precisão do produto:** as condições de teste são diferentes e nenhuma é real. A comparação útil virá das duas medições em celular real: sessão de 20 cartas reais e o protocolo de 30 páginas (`docs/scanner-2.0-avaliacao.md`). Os dois modos ficam independentes: este PR não toca o modo página, e o #324 não toca a sessão contínua.
