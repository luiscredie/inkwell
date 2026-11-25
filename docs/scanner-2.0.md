# Scanner 2.0: Escanear página

Status: **protótipo em PR draft** (arquitetura aprovada pelo Conselho em 24/11 para continuar). Nada aqui está publicado. A meta de 95% ainda **não** foi medida com fotos reais: o protocolo está em `docs/scanner-2.0-avaliacao.md`.

## 1. Auditoria do scanner atual (A1)

Código: `src/site/colecao/colecao.template.html`, seções "escanear" e "scanner screen". Testes: `tools/colecao.spec.mjs` (câmera falsa).

| Peça | Como funciona hoje | Reaproveitada no modo página |
|---|---|---|
| Índice de cartas | `tools/build_scan_index.py` gera `site/data/scan-index.bin` (3.521 cartas × 576 valores int8, ≈2 MB) e `scan-index.json` (ids). | Sim, sem mudança. |
| Impressão digital | Área da arte em 16×12 células → média de cor → CIELAB → padronização por canal → vetor unitário. | Sim (`fingerprint`, `integral`). |
| Reconhecimento | `identify(img)`: busca grossa em 63 posições/escalas, refinamento em volta das 3 melhores, similaridade de cosseno com todas as cartas. Resultado com `confident`, `group` (mesma arte), `score` e `gap`. | Sim. Agora aceita uma grade menor (`POCKET`, 36 posições) e devolve `top` (sugestões). |
| Impressões com a mesma arte | OCR (Tesseract.js no aparelho) da linha de colecionador; `pickByCollector`. | Sim. A faixa é recortada da foto original em alta resolução. |
| Estabilidade | 3 quadros iguais e parados antes de aceitar. | Não se aplica: o modo página usa uma foto parada. |
| Lista e confirmação | `scan.added` → `showReview()` → `change()` → um `apply_collection_delta`. "Nada é salvo antes de você confirmar." | Sim: o modo página só alimenta `scan.added`. |
| Idioma, foil, quantidade | Na revisão (idioma por grupo e "idioma de todas"); foil na captura. | Foil e quantidade por posição; idioma na revisão existente. |

## 2. Alternativas para achar nove cartas numa foto

| Opção | Prós | Contras | Decisão |
|---|---|---|---|
| A. Moldura-guia 3×3 + cantos ajustáveis + homografia + grade regular | Leve (JS puro, sem download extra); privado; previsível; fácil de manter; funciona no navegador e no Capacitor. | Depende da pessoa alinhar a página (com ajuste dos cantos). | **Escolhida para o protótipo.** |
| B. Detecção automática da borda da página (bordas + Hough/contorno) | Dispensa o alinhamento manual. | Fichários escuros, plástico refletivo e fundos variados tornam a borda instável. | Próxima etapa: refinar os cantos sugeridos pela opção A, nunca substituí-la. |
| C. OpenCV.js | Algoritmos prontos (contornos, perspectiva). | ≈8–10 MB de WASM a baixar; manutenção maior. | Não agora. |
| D. Detector treinado (YOLO/SSD via TF.js ou ONNX) | Robusto a cartas soltas e desalinhadas. | Precisa de conjunto rotulado, modelo de vários MB e treino contínuo. | Só se B falhar em fotos reais. |
| E. Reconhecimento em servidor | Modelos maiores. | Envia fotos do usuário para fora; custo; offline impossível. | Descartada (privacidade). |

## 3. Arquitetura (A2)

```
foto parada (câmera hoje; galeria depois)
  └─ cantos iniciais = moldura na tela  ──(arrastar)──┐
src/site/pagescan.js (puro, testado no Node)           │
  warp(): homografia + 2×2 amostras por pixel          │
  cells(): grade do layout (3×3; 2×2 e 4×4 já descritos)
  crop() + texture(): bolso vazio?                     │
  identify() do scanner atual (injetado)               │
  classify(): ok | choose | check | unknown | empty ◄──┘ reconhecer de novo
colecao.template.html
  identifyPocket(): cor; se não houver certeza, só luminância (vira "Confira", nunca "ok")
  pickPrintings(): OCR da linha de colecionador nas posições "choose"
  tela "Confira a página": contornos, 9 posições, editor por posição
  └─ "Pôr N cartas na lista" → scan.added → Concluir → revisão existente → 1 gravação
```

- **Layouts:** `LAYOUTS` em `pagescan.js`. Para 2×2 e 4×4 basta expor a escolha na interface.
- **Galeria:** `pageFrom(canvas, quad)` já recebe qualquer imagem parada. A importação só precisa de um `<input type="file">` que chame essa função.
- **Privacidade:** a foto não sai do aparelho e não é guardada. Só o resultado confirmado vira uma alteração de coleção. O OCR roda no aparelho, mas o Tesseract é baixado do jsDelivr (como já acontece no scanner atual).

## 4. Como evitar erro, duplicidade e gravação indevida

1. **Nada é gravado antes da confirmação final.** O modo página só põe cartas na lista local. A gravação continua sendo o "Adicionar N cartas à coleção" da revisão. Coberto por teste: zero chamadas `apply_collection_delta` até o fim.
2. **Dúvida nunca entra sozinha.** `toList()` recusa a página enquanto houver posição "choose", "check" ou "unknown" sem decisão. O botão mostra "Resolva N posições".
3. **Luminância é só sugestão.** Uma carta achada só pela estrutura de claro e escuro aparece como "Confira", com a carta em primeiro lugar.
4. **Bolso vazio** é detectado pela textura e fica fora. A pessoa pode buscar a carta se houver uma ali.
5. **Mesma página duas vezes seguidas:** a assinatura (ids em ordem) igual à anterior exige um segundo toque ("Estas mesmas cartas já foram para a lista…").
6. **Correção visível:** o editor mostra a posição como foi fotografada, ao lado das sugestões, e oferece busca por nome, foil, quantidade (0 = fora) e "Deixar de fora".
7. **Esc ou voltar** sai da conferência sem adicionar nada.

## 5. Medições (A3), primeira rodada (substituída pela seção 7)

Ferramentas: `tools/pagescan_synth.py`, que gera páginas sintéticas a partir das imagens reais das cartas, e `tools/pagescan-bench.spec.mjs`, que roda o código da página com os cantos "alinhados à mão" (desvio de até 2%), nunca os verdadeiros.

Conjunto medido em 24/11/2026: semente 11, 64 páginas (8 por condição), 553 cartas e 23 bolsos vazios, no Chromium desktop do ambiente de desenvolvimento.

| Condição | Identificadas* | Sem ação, corretas | Pedem a pessoa | Confiantes e erradas |
|---|---|---|---|---|
| Limpa | 100% | 77,9% | 22,1% | 0 |
| Inclinada (perspectiva) | 100% | 80,9% | 19,1% | 0 |
| Girada (±8°) | 100% | 76,8% | 23,2% | 0 |
| Reflexo | 100% | 87,5% | 12,5% | 0 |
| Pouca luz | 100% | 61,2% | 38,8% | 0 |
| Desfoque | 100% | 77,9% | 22,1% | 0 |
| Foil (brilho arco-íris) | 87,1% | 24,3% | 75,7% | 0 |
| Difícil (inclinada + reflexo + escura + foil) | 73,2% | 40,8% | 59,2% | 0 |
| **Total** | **94,9%** | **65,8%** | **34,2%** | **0** |

\* Identificada: a carta certa reconhecida sozinha, ou como primeira sugestão a confirmar, ou entre as impressões oferecidas.

- **Bolsos vazios:** 22 de 23 corretos. O que errou tinha reflexo e foi marcado "não reconhecida", ficando de fora. Nenhuma carta foi tomada por vazia.
- **Tempo por página:** mediana de 1,35 s e máximo de 1,64 s no Chromium desktop.
- **OCR não medido:** as posições "escolha a impressão" (reimpressões) contam como "pedem a pessoa". O OCR deve reduzir isso, mas o ambiente de teste não acessa o CDN do Tesseract.

**O que esses números não dizem:** as fotos são sintéticas; o tempo é de desktop, não de celular; o foil é simulado. Antes de afirmar qualquer meta, é preciso um conjunto de fotos reais (sugestão: 30 páginas, de 3 aparelhos, com luz variada e foils reais), rodado com o mesmo `pagescan-bench.spec.mjs` e um `truth.json` preenchido à mão.

## 7. Segunda rodada (24/11, após a revisão do Conselho)

### Índice de reconhecimento
- **Antes:** 3.521 de 3.767 cartas do catálogo (93,5%). O índice era de 19/10 e o catálogo de 08/11. O gerador ignorava as 79 imagens AVIF, e uma carta nova (LOR14-M01) ficou de fora.
- **Agora:** 3.601 (95,6% do catálogo, **100% das cartas que têm imagem**). As 3.521 impressões antigas são idênticas byte a byte. As 166 cartas restantes não têm imagem nenhuma no site.
- `tools/scan_index_check.py` compara índice, catálogo e imagens. No CI só emite aviso, para uma imagem nova na `main` não travar o deploy; `--strict` falha.

### Motor num Web Worker
- O motor saiu da página para `src/site/scanengine.js` (código idêntico). O scanner de uma carta usa o mesmo módulo e continua passando nos 73 testes de Coleção mais Escanear página.
- O "Escanear página" roda num Worker montado com os mesmos módulos. Se o Worker falhar, a página faz o trabalho sozinha.
- **Medido** (Chromium desktop, 4 páginas):

| | Sem Worker | Com Worker |
|---|---|---|
| Tarefas longas na tela | 33 | 0 |
| Maior travamento | 270 ms | 0 ms |
| Tela travada no total | 4,6 s | 0 s |

  O tempo total fica ~13% maior com o Worker (cópia da foto).
- Bug achado pelo teste no WebKit e corrigido: a URL do Worker era revogada antes de o WebKit ler o script.

### Bolsos vazios: nada sai em silêncio
- Posição vazia ou não reconhecida mostra o **recorte da foto**, não um ícone.
- O rodapé sempre diz o que fica de fora, por exemplo: "Ficam de fora: 1 posição vazia (9) · 1 deixada de fora (4). Se houver carta em alguma, toque nela para buscar." Isso é coberto por teste.
- Medido no sintético: nenhuma carta foi tomada por vazio. O limiar ainda precisa ser validado em fotos reais.

### Foil
- Experimento: tirar o gradiente lento (ajuste de um plano) da luminância da foto e do índice, só no fallback, que nunca é automático.
- Ficou ligado por padrão no modo página; `PAGESCAN_EXP=nodetrend` desliga para comparação.

### Métricas novas (pedido do Conselho) e resultado sintético
O "identificado" agora é estrito: automática certa + 1ª sugestão certa. Na primeira rodada contava também a carta certa em qualquer lugar da lista de impressões, por isso o **94,9% anterior não é comparável**.

553 cartas, 64 páginas sintéticas, Chromium desktop:

| | Sem o ajuste de foil | Com o ajuste (padrão) |
|---|---|---|
| Automática certa | 65,6% | 65,6% |
| 1ª sugestão certa | 22,2% | 24,4% |
| Certa nas alternativas | 8,9% | 8,7% |
| Fora das sugestões | 3,3% | **1,3%** |
| Falsos positivos | 0 | 0 |
| Carta tomada por vazio | 0 | 0 |
| **Identificação** | 87,9% | **90,1%** |
| Ao alcance | 96,7% | 98,7% |

Por condição, com o ajuste:
- Foil: fora das sugestões caiu de 7,1% para 2,9%.
- Difícil: fora das sugestões caiu de 18,3% para 7,0%, e a 1ª sugestão certa subiu de 32,4% para 46,5%.
- As demais condições não mudaram.

O foil sintético é um brilho arco-íris simulado; o efeito em foil real precisa ser medido.

## 8. Próximos passos

1. Fotos reais pelo protocolo (`docs/scanner-2.0-avaliacao.md`). Isso decide se B (detecção de bordas) é necessária e valida o limiar de vazio.
2. ~~Web Worker~~ feito (seção 7). Falta medir o tempo em celulares reais.
3. Foil: medir o ajuste em foils reais; se não bastar, um índice dedicado a foils.
4. Importar da galeria (`pageFrom`), layouts 2×2 e 4×4, e cantos sugeridos automaticamente.
