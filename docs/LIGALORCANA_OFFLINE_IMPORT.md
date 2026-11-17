# LigaLorcana — importador offline de preços por impressão

## Escopo e status

Protótipo **não publicável**. Lê somente arquivos locais recebidos de uma fonte autorizada e produz snapshots de revisão. **Não acessa a rede**, não modifica `site/data/prices.json`, `price-history.json`, manifest, banco de dados, workflows ou páginas da aplicação. Não substitui os coletores legados. A LigaLorcana permanece a fonte de referência em BRL; TCGplayer/ReefAPI não participam deste fluxo.

A pesquisa de novembro/2026 concluiu que `cardsjson` fornece mínimos/médios/máximos **misturados** e `cards_editions` na página individual contém `price["0"]` (Normal) e `price["2"]` (Foil). Acesso automatizado às listagens foi recusado por Cloudflare (403); este programa não executa nem contorna coleta.

## Uso

Requer Python 3.11+, somente biblioteca-padrão.

```bash
python tools/ligalorcana_offline_import.py \
  --catalog /caminho/coleta-pendente.json \
  --input /caminho/respostas_autorizadas/ \
  --master site/data/cards.json \
  --outdir build/ligalorcana-offline

python -m unittest tools/test_ligalorcana_offline_import.py
```

`--catalog`: JSON `cardsjson` (com IDs internos Liga) ou arquivo da coleta legada de 16/11 com `records[]`. A coleta legada **não possui** `liga_card_id` e `liga_edicao_id`: o importador só os preenche a partir de cada documento `cards_editions` efetivamente recebido. Nunca inventa IDs. No catálogo legado, a associação inicial é feita por edição, número e nome desambiguado; colisões não resolvidas vão para o relatório. `--master` valida os IDs do Inkwell quando disponíveis; IDs não verificados são deixados sem correspondência e exigem revisão.

`--input`: um arquivo ou diretório contendo JSONs no formato `{ "_fonte": "https://...", "_capturado_em": "2026-11-17T16:58:00Z", "cards_editions": [...] }`, arrays JSON com objetos `cards_editions`, ou CSV canônico descrito abaixo. Ao importar array sem timestamp, forneça `--captured-at` com fuso (ex.: `2026-11-17T16:58:00Z`). A data de execução não substitui a data da captura.

CSV canônico para parceiros que forneçam arquivo autorizado (delimitador `;`):

```
liga_card_id;liga_edicao_id;edicao;numero;nome;source_url;captured_at;n_min;n_med;n_max;f_min;f_med;f_max;n_status;f_status
3230;9;LOR14;162;A Dark Age No More;https://www.ligalorcana.com.br/?view=cards/card&card=A%20Dark%20Age%20No%20More%20(162)&ed=LOR14&num=162;2026-11-17T16:58:00Z;4.60;5.54;10.00;7.80;10.00;10.90;ok;ok
```

Não há pressuposto de que a Liga entregará esse CSV: será necessário adaptar o importador ao formato real autorizado, se diferente.

## Identidade e qualidade

- Identidade: `(liga_card_id, liga_edicao_id, numero)`; mesmo `liga_card_id` pode ocorrer em reimpressões distintas.
- Colisões na coleta antiga (por exemplo, Q1-223) exigem também identificação inequívoca pelo nome/URL.
- Os preços são convertidos de texto decimal para **centavos inteiros**, sem arredondamentos automáticos; mínimo ≤ médio ≤ máximo. Faixas inválidas são sinalizadas.
- `price["2"] = []` é **sem_oferta**; ausência de `"2"` é **campo_ausente**; impressão sem resposta é **nao_coletado**; dado inválido é **invalido**. Uma impressão não importada não é tomada como sem oferta.
- Outros acabamentos (Promo/Assinada/etc.) não são confundidos com Normal/Foil.
- `ls` (vendas dos últimos 3 meses) é **excluído**, para não misturar vendas com anúncios.
- `capturado_em` é sempre o horário da fonte; `importado_em` é apenas horário de processamento.

## Saída (nunca publicada automaticamente)

```
build/ligalorcana-offline/
  precos/AAAA-MM-DD.json         # todas as impressões: consultadas e não consultadas
  historico/index.json           # datas existentes, sem alterar dados anteriores
  relatorio.json                 # contagens e problemas de validação
```

Snapshots de datas já existentes são imutáveis: uma nova importação no mesmo dia é recusada por padrão. O programa não escreve em `site/`, não cria PR sozinho e não mescla preços antigos para fazer parecer que foram atualizados. `publicavel: false` é explícito. Registros não coletados preservam `capturado_em: null`.

O arquivo histórico gerado é **um staging independente**; a exportação futura para os modelos `n/nl/nh` e `f/fl/fh` deve ser especificada e aprovada separadamente, com validação de semântica e sem sobrescrever a base publicada.

## Cobertura e limitações

A coleta de 16/11 relatou 3.808 impressões (3.672 com oferta e 136 sem oferta na listagem). O importador representa todas as impressões do catálogo, mas só registra faixas Normal/Foil efetivamente fornecidas nos arquivos de entrada. Dados históricos da listagem com extremos misturados **não são tratados como seis preços**, nem usados para preencher lacunas.

O mapeamento `inkwell_card_id` oriundo de catálogos legados deve ser revisado; em catálogos `cardsjson` sem ID do Inkwell o vínculo ficará pendente. Reimpressões não são mescladas. Para produção serão necessários acesso autorizado pela Liga e revisão do contrato de saída.
