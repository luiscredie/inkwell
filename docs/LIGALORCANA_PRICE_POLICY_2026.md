# Decisões aprovadas — pipeline de preços LigaLorcana

Data: 2026-11-17 (America/Sao_Paulo). Status: **política aprovada; implementação e publicação NÃO autorizadas**.

## Decisões do proprietário

1. **Fonte principal:** LigaLorcana em BRL. TCGplayer não substitui preço da LigaLorcana nem preenche automaticamente lacunas na fonte principal.
2. **Valor exibido:** menor preço válido, Normal `nl` e Foil `fl`, preservando o comportamento já usado em Coleção, Decks, Trocas e Preços. `n` e `f` são os preços médios; `nh` e `fh` máximos.
3. **Sem oferta ou coleta inválida:** preservar o último preço válido **da LigaLorcana**, com indicador claro da idade da última oferta válida. Sem valor anterior confiável, não inventar preço nem usar TCGplayer como substituto. Não foi autorizado prazo de expiração automática.

## Tratamento por acabamento, sem travar lote

- `ok`: substituir as três chaves do acabamento como conjunto atômico, após verificar valores positivos e ordenação min <= médio <= max.
- `no_offers`, `missing`, `partial`, `not_collected`: preservar as chaves anteriores daquele acabamento e carregar status/timestamp para indicador de idade.
- `invalid_order`: preservar valores brutos e status para auditoria; **não** aplicar os valores inconsistentes e **não** bloquear a captura, a edição ou o restante do lote.
- Normal e Foil são independentes; falha de um nunca descarta o outro.
- Se não houver preço válido da Liga já armazenado, omitir as chaves (não usar 0, null ou cotação TCGplayer).

### Caso de regressão obrigatório

LOR13 #226, Mike Wazowski — Heroic Climber (Enchanted): Normal mínimo R$ 890,99, médio R$ 982,50, máximo R$ 975,00. Registrar os três valores originais, status `invalid_order`, prosseguir coleta; preservar Normal válido anterior, quando houver; processar Foil separadamente.

## Pacote final que nosso pipeline entregará ao aplicador

Em `coletas/ligalorcana/aplicar/AAAA-MM-DD/`:
- `snapshot.json`: identificação pelo card_id verificado em cards.json, seis preços já convertidos a BRL (`n,nl,nh,f,fl,fh`), status por acabamento, timestamp de captura, vínculo bruto e fonte, data de referência em America/Sao_Paulo;
- `delta.json`: mudanças propostas vs base exata;
- `manifest.json`: hashes de todos os arquivos, mapa de IDs revisado, cards.json e prices.json-base, contagens por edição;
- `qualidade.json`: cobertura, sem ofertas, preço velho, inválidos, não mapeados, duplicatas, incompatibilidades e motivos de bloqueio.

O gerador nunca associa automaticamente uma impressão a um card_id duvidoso. Resolver o mapa com validação explícita (Q1 #223, LOR14, D23/D23C, Q3 e variantes). O aplicador deve recusar pacotes com integridade ou correspondência inválida; problemas em preços individuais permanecem isolados.

## Atenção: workflow diário existente

`.github/workflows/daily-prices.yml` atualmente pode regenerar `site/data/prices.json` com TCGplayer e reverter o efeito de uma futura aplicação. **Não desligar, alterar nem mesclar nesta etapa.** Antes da primeira atualização autorizada, desenvolver e testar PR próprio de migração para LigaLorcana como fonte principal; definir proteção contra overwrite e plano de rollback. Uma implementação não estará pronta para publicar até esse conflito estar resolvido.

## Indicador de idade

Mostrar data/hora da última **oferta válida da Liga** por carta/acabamento; distinguir informação atual de valor preservado por falta de oferta, sem perder a rastreabilidade. Propor mudança de front separada, com testes móveis; não colocar `usd_brl` em saída exclusiva da Liga. Não mudar o critério de cálculo pelo menor preço.

## Segurança e sequência de trabalho

1. A coleta Chrome atual continua sem reinstalação, reinício ou alteração.
2. Nossa pipeline finaliza mapeamento, normalização, consolidação, validação, snapshot/delta/manifesto e relatórios; verificar idempotência e processamento automático.
3. Claude apenas consome pacote final preparado, confere hashes, executa simulação e testes, e propõe PR de atualização.
4. Testar integração completa, indicador de idade, retenção de histórico e solução do workflow diário.
5. **Somente autorização explícita posterior** permite merge/deploy/publicação. Não alterar `site/data`, banco ou preços agora.

Referências: PRs #248 e #252; resposta técnica de integração recebida em 17/11/2026.
