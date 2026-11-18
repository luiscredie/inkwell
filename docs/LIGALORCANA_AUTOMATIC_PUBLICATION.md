# LigaLorcana — automação de preços (proposta, não publicada)

Fluxo previsto: extensão v0.8.1 → `coletas/ligalorcana/coleta/` (brutos) → `tratados/` + `data/` → `aplicar/AAAA-MM-DD/<hash>/` → PR automático com atualização de `site/data` → checks da main → merge e deploy.

## Código

- `tools/ligalorcana_release_candidate.py`: consolida todos os arquivos de coleta, preserva nomes e centavos auditáveis, resolve apenas IDs revisados ou identidade inequívoca (edição+número+nome), normaliza estados por acabamento, computa histórico, hashes, cobertura e gera pacote de aplicação imutável.
- `tools/ligalorcana_apply_candidate.py`: revalida hashes, mapa/cartas/base, chaves e valores antes de escrever no **worktree de PR**, nunca diretamente na main.
- `.github/workflows/ligalorcana-auto-pipeline.yml`: executa quando a extensão fizer push dos arquivos brutos à branch `feature/ligalorcana-review-pipeline`. Gera e arquiva pacote, e apenas quando todos os gates forem satisfeitos abre PR separado contra main.
- `.github/workflows/ligalorcana-stage.yml`: etapa antiga permanece manual para não duplicar o processamento.
- `.github/workflows/daily-prices.yml`: cron de TCGplayer removido **nesta branch**, pois do contrário sobrescreveria os preços da Liga; somente entrará em vigor quando a mudança correspondente chegar à main.

## Pacote de saída

Em `coletas/ligalorcana/aplicar/<data-SP>/<hash-fontes>/`:
`snapshot.json`, `delta.json`, `qualidade.json`, `manifest.json`, `prices.candidate.json`, `price-history.candidate.json`.

- `nl` e `fl`: preço mínimo; `n` e `f`: médio; `nh` e `fh`: máximo.
- `missing`, `no_offers`, `partial`, `invalid_order`: não atualizam o acabamento, preservando somente o último valor **com proveniência LigaLorcana**. TCGplayer não preenche lacunas.
- Mike Wazowski LOR13 #226: Normal com média acima do máximo gera alerta sem parar o lote; Foil válido pode ser usado.
- `ligalorcana_last_valid_at`: metadados por carta/acabamento para futura exibição da idade do último preço válido. A **interface visual** desse indicador ainda demanda alteração e testes de front.
- As capturas brutas não são alteradas nem removidas. Um mesmo conjunto de entradas é idempotente; novos conjuntos do mesmo dia têm outra pasta com hash.

## Regras para abrir PR de preços automaticamente

1. Cobertura mínima de **98% dos IDs do catálogo Inkwell**; este valor é deliberadamente conservador e poderá ser ajustado depois de medir a cobertura real, nunca para contornar problemas.
2. Sem colisões de identidades e sem dia já gravado no histórico.
3. Pelo menos um preço válido; preços inconsistentes isolados, nunca inventados.
4. Correspondência por ID revisado ou identidade comprovada por nome + edição + número. `site/data/ligalorcana-id-map.json` deve ser gerado/revisado, incluindo LOR14, Q3, D23C, Q1 #223.
5. Cron TCGplayer desativado no checkout **e na main**.
6. Snapshot e base de preços com hashes correspondentes.
7. `refresh_data_manifest.py`, `validate_release.py` e `build_site_pages.py --check` aprovados, seguidos dos quatro checks exigidos pela ruleset: `js`, `python`, `smoke`, `journeys-webkit`.

A publicação pela main ocorre apenas após merge de PR. Se o **Inkwell bot** estiver configurado, o PR pode executar seus checks automaticamente. O auto-merge só será requisitado com a variável explícita `LIGALORCANA_AUTO_MERGE=true` — não habilitada por este PR.

## Estado e limitações

- Desenvolvimento feito em branch isolada, sem alterar a extensão Chrome em coleta.
- Testes locais de regressão sobre Mike #226 e reprocessamento passaram.
- Ensaio com 417 capturas reais + catálogo/mapa sintéticos passou; **não** valida o catálogo real de produção.
- Ainda não há prova de fluxo completo em GitHub Actions na branch final, nem mapeamento completo revisado. O front ainda não exibe a idade do preço.
- Não há autorização implícita para merge imediato deste PR, nem para contornar os critérios de qualidade.

**Antes de ativar o fluxo**: concluir mapeamento, validar CI em branch de integração, revisar indicador de idade na UI, coordenar desativação do cron TCGplayer em main e testar primeiro PR de preços com simulação e rollback.
