# Métricas do produto (issue #145, P0-B)

Esquema dos eventos que o site envia para `public.track` (supabase/site_stats.sql + supabase/metrics_p0.sql).
O relatório fica em Admin → Painel → "Métricas do produto" (`public.admin_metrics`, só administradores).

## O que é enviado

Cada chamada tem exatamente estes campos e nada além deles. Não vai e-mail, nome, código de entrada nem conteúdo.

| Campo | Valor |
|---|---|
| `p_sid` | código aleatório da aba (sessionStorage, 24 hex); some quando a aba fecha |
| `p_page` | página (`feed`, `decks`, `cards`, `start`…) |
| `p_kind` | `view` (página aberta) ou `action` |
| `p_name` | nome do evento (só em `action`) |
| `p_ref` | domínio do site de origem (só em `view`; nunca o endereço completo) |
| `p_dev` | `mobile` ou `desktop` |

O servidor anota se havia login (sim/não). Não guarda IP nem cookie.

## Eventos

| Evento | Quando |
|---|---|
| `page_view` | qualquer página aberta (`kind = view`) |
| `try_deck_started` | sem conta, em Decks: colou/digitou uma lista ou pediu o exemplo (1ª vez na página) |
| `deck_sample_loaded` | tocou em "Experimentar com um deck de exemplo" |
| `signup_started` | pediu o código de entrada por e-mail |
| `signup_completed` | entrou e a conta foi criada há menos de 15 min (conta nova) |
| `deck_saved` | um deck foi salvo na conta (vindo do teste sem cadastro) |
| `profile_started` | começou o perfil em "Criar meu perfil" |
| `profile_saved` | o perfil foi salvo na conta |
| `collection_started` | sem conta, na Coleção: tocou em "Criar conta e começar minha coleção" |

Nomes antigos (antes de 03/11/2026) são contados sob os novos: `deck_sample` → `deck_sample_loaded`,
`profile_start` → `profile_started`, `collection_start` → `collection_started`, `signin_code` → `signup_started`.
Outros eventos auxiliares continuam (`deck_result`, `deck_save`, `deck_paste`, `signin_open`, `signin_done`, `scan_open`…).
`deck_added_to_collection` (04/11/2026): adicionou um deck inteiro à coleção. Enviado só depois de a gravação dar certo, nunca ao cancelar ou falhar.

`deck_image_created` (04/11/2026): criou a imagem de um deck (Decks → Visão geral → Compartilhar imagem). Enviado quando a imagem fica pronta, uma vez por visita à página; não diz se a pessoa baixou ou compartilhou, nem qual deck.
É um evento do navegador, como os outros desta lista: não é contagem do banco. Não leva quantidade, nome ou dado pessoal.
Usa o `public.track` como está (nome `[a-z_]`, até 30 letras), sem mudança no esquema. Não entra nos 9 eventos do relatório P0.

## Definições

- **Visita / sessão**: uma aba do navegador (código aleatório que some ao fechar a aba). **Não é número de pessoas**: uma pessoa gera
  várias visitas (outra aba, outro dia, outro aparelho, aba anônima). Sem cookie não há como juntá-las, por escolha de privacidade.
  Não usamos a expressão "visitantes únicos".
- **Membro ativo 7d / 30d**: contas distintas que abriram pelo menos uma página com login nos últimos 7 / 30 dias.
  Para isso o servidor guarda só (conta, dia) em `private.member_days`, sem página nem ação.
- **Contas criadas / com perfil / com deck**: `auth.users.created_at` no período; destas, quantas têm linha em `profiles` e quantas têm
  pelo menos um deck com nome. Vêm do banco, não do navegador.
- **Deduplicação**: cada ação conta uma vez por página aberta (no navegador) e o mesmo evento da mesma aba em 3 s é descartado (no servidor);
  uma aba para de contar depois de 400 eventos no dia.
- **Quem não é contado**: administradores, navegadores automáticos (testes) e navegadores com "não rastrear" (DNT) ou Global Privacy Control.
- **Retenção**: 90 dias (eventos e dias de membro), apagados todo dia pelo cron `inkwell-trim-stats`.
- **Zeros**: o relatório lista os 9 eventos sempre; sem ocorrência aparece 0. Não há número simulado.
- **Seus dados**: os dias de uso vêm em "Baixar meus dados" e somem ao excluir a conta.

## Limitações (inflação artificial)

`public.track` é chamada pelo navegador, com ou sem conta, como em qualquer ferramenta de analytics no site. Então:

- **Visitas e eventos podem ser inflados** por quem chamar a API diretamente ou abrir muitas abas: cada código de aba novo é uma
  visita nova. Defesas atuais: formato validado, 400 eventos por aba por dia, o mesmo evento da mesma aba em 3 s conta uma vez, e
  acima de 600 eventos por minuto no site inteiro o resto daquele minuto não é contado. Elas limitam um abuso, não o impedem.
- **`signup_completed` e os demais eventos de ação são declarados pelo navegador.** Para números a apresentar a terceiros
  (patrocinadores), usar os que vêm do banco: **contas criadas, com perfil, com deck, membros ativos 7d/30d** (só contam contas reais
  que abriram o site com login).
- **Subcontagem**: navegadores com DNT/GPC, bloqueadores de conteúdo e quem fecha a página antes do envio não aparecem.
- **Membros ativos** dependem de a pessoa abrir uma página com login; quem só usa o contador offline não aparece.
- Sem IP e sem cookie, não há detecção de robôs além do `navigator.webdriver`.

## Migração e testes

`supabase/metrics_p0.sql` roda numa transação. Só segue se `my_data_export()` for exatamente uma de duas versões (md5 da definição
sem `\r`): a de produção validada em 03/11/2026 (`5be3e54d…`) ou a que esta migração escreve (`d56e4216…`, para poder rodar de novo).
Qualquer outra versão, mesmo uma já migrada e alterada depois, interrompe a transação inteira sem mudar nada.
`tools/metrics_p0_sql_test.sh` confere num Postgres local: só as funções esperadas mudam, rodar duas vezes não muda mais nada,
exportação com os dias, exclusão da conta apaga os dias, retenção de 90 dias, só admin lê as métricas, tabelas fechadas para
`anon`/`authenticated`, deduplicação, limite por minuto, e que uma função migrada e alterada depois não é sobrescrita.
`tools/fixtures/prod_shape.2026-11-04.sql` é uma cópia isolada do formato de produção (colunas, definições com as quebras de linha
originais e permissões, lidas só por consulta em 04/11/2026; sem dados): a migração foi rodada nela duas vezes, com os mesmos resultados.
