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
1. Informar aparelho, luz, se está inclinada e se tem foil. Informar também o **tempo no aparelho** e **onde** foi medido
   (app Android, app iOS ou navegador do celular): é o número no canto do rodapé da tela "Confira a página" quando
   aquela mesma página foi escaneada no aparelho (passo 4). A lista marca ✓ quando a foto está completa.
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
- **Correção manual** = certa nas alternativas + fora das sugestões (a pessoa escolhe outra opção ou busca pelo nome).

O relatório separa, por aparelho e no total: **automática certa**, **1ª sugestão certa**, **correção manual**, **carta
tomada por vazio** e **falsos positivos** (de cartas e de bolsos vazios), que somam todas as cartas; e o **tempo no
aparelho** (mediana e máximo, digitado no gabarito), à parte do tempo no computador que mede.

## 4. Como medir

```bash
cd site && python3 -m http.server 8080 &
PAGESCAN_DIR=/caminho/das/fotos PAGESCAN_OUT=/caminho/das/fotos/relatorio.json PAGESCAN_MD=/caminho/das/fotos/relatorio.md PAGESCAN_JITTER=0.02 \
  npx playwright test --project=chromium tools/pagescan-bench.spec.mjs
```

- `PAGESCAN_JITTER=0.02` desloca os cantos anotados em até 2%, como um alinhamento feito à mão. Rodar também com `0` (cantos ajustados com cuidado) e com `0.04`.
- O relatório traz o total, a quebra por aparelho e por condição, e o veredito de cada posição.
- **Tempo em celular:** cada página é também escaneada no próprio aparelho (Coleção → Escanear → Página 3×3, câmera ou galeria) e o tempo exibido no rodapé da tela de conferência vai para o gabarito. Anotar à parte se a tela travou ao rolar durante o reconhecimento.
- O relatório (`relatorio.md`) primeiro diz se o conjunto cumpre a seção 1 (páginas, aparelhos, páginas por aparelho, bolsos vazios, páginas com foil, tempos preenchidos). **Com o conjunto incompleto ou com fotos sintéticas, nenhuma meta é julgada**: a coluna diz "não avaliável".

## 4a. Validação do procedimento (feita em 25/11, sem fotos reais)

`tools/pagescan-a3.spec.mjs` percorre o caminho inteiro como a pessoa fará: 6 fotos geradas de 3 "aparelhos" →
anotadas na ferramenta (cantos clicados com rolagem, cartas digitadas, aparelho, tempo, luz) → `truth.json` exportado →
o mesmo reconhecimento do benchmark → relatório. Confere que cada carta entra em exatamente uma categoria, que o tempo
de cada foto chega ao relatório e que o conjunto é dito incompleto, sem meta julgada. A mesma pasta passou também pelo
`pagescan-bench.spec.mjs`. `tools/pagescan-report.test.mjs` testa as regras do relatório (inclusive um conjunto completo
em que a meta de tempo **não** é atingida). As duas verificações rodam no CI. Esses números **não** medem o produto.

Achados da validação, já corrigidos: a marca ✓ da lista só aparecia ao trocar de foto; o benchmark carregava as fotos
com `Image.decode()` (o mesmo problema da #333) e agora usa `createImageBitmap`, aplicando a orientação EXIF da foto.

## 4b. Roteiro por aparelho (para quem fotografa)

1. Separar 10 páginas reais (seção 1: luz boa, reflexo, luz fraca, inclinada; foils e bolsos vazios espalhados).
2. Para cada página: fotografar com a câmera do aparelho (resolução normal, sem filtro) **e** escanear no Inkwell
   (Página 3×3); anotar o tempo do rodapé. Não corrigir nada no Inkwell; descartar a lista ao final (nada é gravado).
3. Passar as fotos para o computador, todas numa **única pasta**, sem editar, com o aparelho no início do nome do
   arquivo (ex.: `iphone13-01.jpg`) para não haver nomes repetidos.
4. Anotar as 30 fotos no gabarito (seção 2; a ferramenta abre várias de uma vez), exportar o `truth.json` para a mesma
   pasta e rodar a seção 4.

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
