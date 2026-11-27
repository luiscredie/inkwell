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
1. Informar aparelho, **sistema** (iOS/Android), se o aparelho é **de entrada ou tem mais de 3 anos**, o **fichário**,
   a luz, se está **inclinada**, se a página tem **reimpressão** e, em cada posição, se a carta é **foil**. Informar também o **tempo no aparelho** e **onde** foi medido
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
- O relatório (`relatorio.md`) primeiro confere **cada item da seção 1**: fotos reais; 30 páginas; 3 aparelhos, com ao menos 1 iPhone e 1 Android e um de entrada ou com mais de 3 anos; 10 páginas por aparelho; por aparelho, 4 com luz boa e de frente, 2 com reflexo, 2 com luz fraca e 2 inclinadas; 15 cartas foil em pelo menos 6 páginas; 6 bolsos vazios em 6 páginas diferentes; 3 páginas com a mesma carta em duas posições; 3 com reimpressão; 2 modelos de fichário; o tempo no aparelho em todas as páginas. **Um dado não registrado conta como não cumprido.** **Com o conjunto incompleto ou com fotos sintéticas, nenhuma meta é julgada**: a coluna diz "não avaliável".

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

## 6. Comparação controlada: vídeo × fotografia (e o filtro de reflexo)

Objetivo: decidir, com medição em aparelhos reais, se a fotografia tirada pelo site (`ImageCapture.takePhoto`, desligada por padrão; `?captura=foto`) reconhece melhor que o quadro do vídeo, e se o filtro de reflexo experimental (`?reflexo=1`, desligado por padrão) ajuda. **Nenhum ganho é declarado antes desta medição.** Emulador não vale para esta seção.

### 6.1 Como a comparação é controlada

Com `?medicao=a3`, cada toque em "Fotografar página" guarda **o quadro do vídeo e a fotografia do mesmo instante**: mesma página, mesmo enquadramento, mesma luz e mesmo reflexo. A diferença medida vem só da captura. Depois que a página da pessoa fica pronta, o site lê as duas imagens com os mesmos passos do uso normal (motor + número de colecionador, quando a versão do site tem essa etapa) e, se o motor tiver o filtro de reflexo, lê as duas de novo com o filtro. A tela não muda: a página da pessoa usa o vídeo, como no padrão. No fim aparece **Baixar medição**: um arquivo JSON por página (formato `a3: 2`).

- **Privacidade:** o arquivo existe só na memória do aparelho e no download. Nada é enviado: nenhuma requisição leva imagem ou medição, o analytics recebe os mesmos nomes de evento de sempre (sem conteúdo) e nada fica guardado no navegador. Isso é verificado em teste automático. As imagens são do fichário da pessoa: ficam no computador que mede, **fora do repositório** (o `.gitignore` ignora `a3-p*.json`, `a3-p*-foto.jpg`, `a3-p*-video.jpg` e `a3-relatorio*` caso caiam ali).
- Num aparelho sem `takePhoto` (iOS < 18.4), a página registra o fallback com o motivo. Isso também é resultado.

### 6.2 Gabarito e relatório

As mesmas definições da seção 3 (`tools/pagescan-report.mjs`: `verdict`, `summarise`): automática certa, 1ª sugestão certa, correção manual, carta tomada por vazio e falso positivo significam exatamente o mesmo aqui.

```bash
node tools/pagescan-a3-compare.mjs extract /pasta/das/medicoes      # gera <nome>-foto.jpg e <nome>-video.jpg
# anotar as -foto.jpg (ou a -video.jpg de uma página sem foto) em tools/pagescan-annotate.html; exportar truth.json para a pasta
node tools/pagescan-a3-compare.mjs report  /pasta/das/medicoes /pasta/das/medicoes/a3-relatorio.json /pasta/das/medicoes/a3-relatorio.md
```

O relatório traz uma coluna por leitura (**video**, **foto**, **video+reflexo**, **foto+reflexo** e **Site**, o que a página usou), por aparelho e no total, e as comparações pareadas.

| Registrado | Como |
|---|---|
| Resolução | vídeo entregue pelo navegador; foto entregue pela câmera e o tamanho mantido (≤ 3000 px no lado maior) |
| Tempo total | por leitura, no aparelho: captura (vídeo: o quadro; foto: quadro + `takePhoto` + alinhamento) + motor + números; e o tempo até a página ficar pronta |
| Sucesso do alinhamento | correlação da foto com o quadro (≥ 0,6 = alinhou); mediana e mínimo |
| Reconhecimento correto | automática certa, 1ª sugestão certa, correção manual, identificação |
| Falsos positivos | por leitura e pareados (posições em que só uma das leituras errou com certeza); também as **sugestões erradas** exclusivas de cada lado |
| Fallback | páginas sem foto ou sem alinhamento, e o motivo |

**Pareado:** para cada posição com carta, conta-se onde só A identificou e onde só B identificou (McNemar exato). **"Evidência de ganho"** só quando A identifica mais, com p < 0,05, e não tem mais falsos positivos que B. Caso contrário, o relatório diz "sem evidência de ganho".

### 6.3 Critérios do Conselho (26/11) para ligar a fotografia por padrão

| Critério | Verificação |
|---|---|
| Nenhuma regressão na captura existente | suíte completa (Chromium + WebKit) verde; com a fotografia desligada o botão roda exatamente o código anterior (teste: nenhuma foto é tirada) |
| Nenhuma perda de interação | a tela de conferência fica pronta e usável no mesmo tempo ou menos; tocar, rolar e resolver posições funcionam durante a leitura (testes + roteiro 7) |
| Fallback confiável | 100% das páginas sem foto ou sem alinhamento caem no vídeo e são reconhecidas; nenhuma página perdida |
| Evidência de melhoria real | **Foto × vídeo** com evidência de ganho (acima) no total; falsos positivos da foto ≤ vídeo (meta 0) |

O filtro de reflexo segue o mesmo critério (**filtro × sem**, nas duas capturas). Sem evidência de ganho, os dois continuam desligados por padrão.

## 7. Roteiro curto de validação física (2–3 páginas, iPhone e Android)

Objetivo: ver no aparelho real se a fotografia funciona, se o fallback funciona e se a interação continua boa, **sem cadastrar nenhuma carta**. Não substitui a seção 1: é a primeira verificação. Cerca de 15 minutos por aparelho.

**Onde:** publicado em inkwell.com.br desde 26/11 (#349, #350, #351; autorização do proprietário). Nada precisa ser servido do computador.

- Medição (página com o vídeo, como no padrão; guarda vídeo e foto): `https://inkwell.com.br/colecao/?medicao=a3`
- Medição com a página usando a foto: `https://inkwell.com.br/colecao/?medicao=a3&captura=foto`
- Os modos valem para a aba aberta: para voltar ao padrão, fechar a aba e abrir `https://inkwell.com.br/colecao/` numa aba nova.
- iPhone: iOS ≥ 18.4 (Ajustes → Geral → Sobre) para haver foto; abaixo disso a medição registra "sem ImageCapture", o que também é resultado.

**Antes (no celular):** abrir a Coleção e **anotar o total de cartas**, para conferir no fim que nada mudou.

**As páginas:** P1 com luz boa e de frente; P2 com reflexo (lâmpada refletindo no plástico); P3 com pelo menos 2 foils, 1 bolso vazio e, se possível, uma reimpressão.

**Para cada página (com `?medicao=a3`):**
1. Coleção → Escanear → Página 3×3. Enquadrar e tocar **Fotografar página** uma vez.
2. Na tela de conferência, anotar o **tempo do rodapé** e se a câmera **piscou, congelou, fez som de obturador ou apagou a lanterna**.
3. Enquanto a faixa "Medição A3…" trabalha, rolar a tela e abrir uma posição: anotar se algo travou ou se um toque se perdeu.
4. Quando a faixa disser "pronta", tocar **Baixar medição** (iPhone: salvar em Arquivos).
5. **Não tocar em "Adicionar"**. Voltar (seta ou Esc) e **descartar** a página.

**Depois, uma vez por aparelho:** repetir a P2 com `?medicao=a3&captura=foto` (agora a própria página usa a foto) e anotar o tempo do rodapé e a sensação de espera, para comparar com o passo 2.

**Ao final:** conferir na Coleção que o **total de cartas é o mesmo**. Passar os arquivos `a3-p*.json` para uma pasta **fora do repositório** no computador e seguir a seção 6.2. As observações dos passos 2 e 3 vão para o PR junto com o relatório.

| Aparelho | Sistema | Página | Tempo do rodapé | Câmera piscou / congelou / som / lanterna | Travou ou perdeu toque | Arquivo |
|---|---|---|---|---|---|---|
| | | P1 | | | | |
| | | P2 | | | | |
| | | P3 | | | | |
| | | P2 (`captura=foto`) | | | | |
