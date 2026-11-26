# Scanner 2.0: protocolo de avaliação com fotos reais

Objetivo: medir o "Escanear página" (3×3) em fotos reais de fichário, com critérios definidos **antes** de olhar os resultados. Sem esse conjunto, nenhum número de precisão vale como resultado do produto. Os números atuais são sintéticos (`docs/scanner-2.0.md`).

## 1. Conjunto de fotos

| Item | Mínimo |
|---|---|
| Páginas | **30** (270 posições) |
| Aparelhos | **3**: pelo menos 1 iPhone e 1 Android; um deles de entrada ou com mais de 3 anos |
| Páginas por aparelho | 10 |
| Condições, por aparelho | 4 com luz boa e de frente; 2 com reflexo do plástico visível; 2 com luz fraca (abajur, fim de tarde); 2 inclinadas (~20–30°) |
| Foils | ≥ 15 cartas foil no total, espalhadas em pelo menos 6 páginas |
| Bolsos vazios | ≥ 6 no total, em páginas diferentes |
| Repetições | ≥ 3 páginas com a mesma carta em duas posições, e ≥ 3 com reimpressões (mesma arte, outra coleção) |
| Fichários | ≥ 2 modelos (páginas pretas e transparentes, se houver) |

Regras de captura:
- A foto mostra a página inteira, em resolução normal da câmera. Sem filtro, sem recorte e sem HDR forçado.
- Não refazer foto "ruim": a foto ruim faz parte do teste. Só se descarta foto em que nem uma pessoa reconheceria as cartas, e o descarte é registrado.
- As fotos são do acervo próprio e **não vão para o repositório**. Ficam numa pasta local; só o relatório agregado é publicado no PR.

## 2. Gabarito

Abrir `tools/pagescan-annotate.html` localmente (instruções no topo do arquivo) e, para cada foto:
1. Informar aparelho, luz, se está inclinada e se tem foil.
2. Clicar nos 4 cantos da área dos bolsos, na ordem pedida, e conferir a grade verde.
3. Em cada posição, escolher a carta pelo nome (o código, por exemplo LOR13-80, fica no gabarito) ou "vazia".
4. **Impressão exata:** se for promo ou reimpressão, escolher o código da impressão que está na foto (veja o número de colecionador).

"Exportar" gera o `truth.json`, que fica na mesma pasta das fotos. Uma segunda pessoa confere 5 páginas sorteadas.

## 3. Métricas (por posição)

| Categoria | Definição |
|---|---|
| **Automática certa** | O scanner marcou "Reconhecida" com a carta certa. Ninguém precisa agir. |
| **Falso positivo** | Marcou "Reconhecida" com outra carta, ou pôs uma carta num bolso vazio. **É o erro grave.** |
| **1ª sugestão certa** | Pediu confirmação e a primeira resposta oferecida (sugestão ou impressão) está certa: um toque. |
| **Certa nas alternativas** | Pediu confirmação e a carta certa está entre as outras opções. |
| **Fora das sugestões** | A pessoa precisa buscar pelo nome. |
| **Carta tomada por vazio** | Uma carta lida como bolso vazio. Não é gravada; a tela diz que ficou de fora. |
| Vazio certo / vazio perguntado | Bolso vazio lido como vazio / enviado à pessoa. |

Indicadores:
- **Identificação** = automática certa + 1ª sugestão certa (a carta que o scanner põe em primeiro é a certa).
- **Ao alcance** = identificação + certa nas alternativas.
- **Precisa da pessoa** = tudo que não é automática.

## 4. Como medir

```bash
cd site && python3 -m http.server 8080 &
PAGESCAN_DIR=/caminho/das/fotos PAGESCAN_OUT=/caminho/das/fotos/relatorio.json PAGESCAN_JITTER=0.02 \
  npx playwright test --project=chromium tools/pagescan-bench.spec.mjs
```

- `PAGESCAN_JITTER=0.02` desloca os cantos anotados em até 2%, como um alinhamento feito à mão. Rodar também com `0` (cantos ajustados com cuidado) e com `0.04`.
- O relatório traz o total, a quebra por aparelho e por condição, e o veredito de cada posição.
- **Tempo em celular:** além do Chromium do computador, abrir a mesma página no celular (Coleção → Escanear → Página 3×3) com 5 fotos de cada aparelho e anotar o tempo exibido na tela de conferência. Também vale anotar se a tela travou ao arrastar e rolar durante o reconhecimento (com o Worker, não deveria).

## 5. Critérios de decisão

| Critério | Meta inicial | Se não atingir |
|---|---|---|
| Identificação | ≥ 95% no total, e ≥ 90% em cada aparelho | Investigar por condição antes de mexer no motor. |
| Falso positivo | **0** em 270 posições; aceitável no máximo 1, com análise | Endurecer o limiar de "Reconhecida" (perde automática, ganha segurança). |
| Carta tomada por vazio | 0 | Revisar o limiar de textura (`EMPTY_LUMA`) com os valores medidos. |
| Ao alcance | ≥ 98% | Melhorar as sugestões, a busca ou o índice. |
| Precisa da pessoa | Medir e reportar (sem meta nesta rodada) | Base para decidir o OCR automático das reimpressões. |
| Tempo por página | ≤ 4 s no aparelho mais lento | Otimizar o motor no Worker (menos posições, SIMD). |

Os resultados são publicados como medidos, inclusive quando não atingem a meta. A meta de 95% só é declarada atingida com este protocolo cumprido.

## 6. Comparação controlada: vídeo × fotografia (captura de alta resolução)

Objetivo: decidir, com medição, se a fotografia tirada pelo site (`ImageCapture.takePhoto`) reconhece melhor que o quadro do vídeo usado até agora. **Nenhum ganho de precisão é declarado antes desta medição.**

### 6.1 Como a comparação é controlada

O site, aberto com `?medicao=a3` (Coleção → Escanear → Página 3×3), guarda **no mesmo toque** o quadro do vídeo e a fotografia. É a mesma página, no mesmo instante, com o mesmo enquadramento, a mesma luz e o mesmo reflexo. A diferença medida vem só da captura, não da mão nem da luz. Depois que a página da pessoa fica pronta (e a leitura dos números termina), o site lê as duas imagens com os mesmos passos do uso normal (motor + número de colecionador), sem mexer na tela, e oferece **Baixar medição**: um JSON por página. Ele traz as duas imagens, os cantos do scanner em cada uma, resoluções, tempos, alinhamento, fallback e o que cada imagem leu em cada posição.

- O modo fica ligado na aba até ela ser fechada. Sem `?medicao=a3`, nada muda no fluxo normal (teste automático garante).
- As mesmas 30 páginas da §1, nos mesmos aparelhos e condições. Uma foto por página basta, porque vídeo e foto saem do mesmo toque.
- **Aparelhos reais** (pelo menos 1 iPhone com iOS ≥ 18.4 e 1 Android com Chrome). Emulador não vale para esta seção.
- Num aparelho sem `takePhoto` (iOS < 18.4), a página registra o fallback com o motivo. Isso também é resultado.

### 6.2 Gabarito e relatório

```bash
node tools/a3_compare.mjs extract /caminho/das/medicoes     # gera <nome>-foto.jpg e <nome>-video.jpg
# anotar as -foto.jpg em tools/pagescan-annotate.html (só as cartas e o aparelho; os cantos não são usados aqui)
node tools/a3_compare.mjs report  /caminho/das/medicoes /caminho/das/medicoes/a3-relatorio.json
```

O relatório (Markdown para o PR + JSON) usa as categorias da §3, separadas em **Vídeo**, **Foto** e **Site** (o que o site de fato usou: a foto quando alinhou, senão o vídeo).

### 6.3 O que é registrado

| Item | Onde |
|---|---|
| Resolução | vídeo entregue pelo navegador; foto entregue pela câmera; tamanho mantido (foto ≤ 3000 px no lado maior) |
| Tempo total por página | captura (vídeo: quadro; foto: quadro + `takePhoto` + alinhamento) + motor + leitura dos números. Também o tempo que a pessoa viu (`ready`, `ocr`) |
| Sucesso do alinhamento | correlação da foto com o quadro (≥ 0,6 = alinhou); mediana e mínimo |
| Reconhecimento correto | identificação, automática certa, 1ª sugestão, ao alcance, por modo e por aparelho |
| Falsos positivos | por modo, e pareado (posições em que só um dos modos errou com certeza) |
| Fallback | quantas páginas usaram o vídeo e por quê (sem ImageCapture, `takePhoto` falhou, não alinhou) |

Pareado: para cada posição com carta, conta-se onde só a foto acertou e onde só o vídeo acertou (teste de McNemar exato). Diferença sem significância é registrada como "sem evidência de ganho".

### 6.4 Critérios do Conselho (26/11) para publicar a captura por fotografia

| Critério | Como se verifica |
|---|---|
| Nenhuma regressão na captura existente | suíte completa (Chromium + WebKit) verde; no A3, a coluna **Site** não fica pior que **Vídeo** em nenhum aparelho |
| Nenhuma perda de interação | a página da pessoa fica pronta no mesmo tempo ou menos; tocar, arrastar cantos e resolver posições funciona durante a leitura (testes + uso no aparelho) |
| Fallback confiável | 100% das páginas sem foto ou sem alinhamento caem no vídeo e são reconhecidas; nenhuma página perdida |
| Evidência de melhoria real | **Foto > Vídeo** em identificação no total, com McNemar p < 0,05, e **falsos positivos da foto ≤ vídeo** (meta 0) |

Se a foto não mostrar ganho medido, a captura por vídeo continua sendo a padrão, e a fotografia fica atrás do modo de medição.
