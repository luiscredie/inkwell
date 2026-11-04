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

## Definições

- **Visita / sessão**: uma aba do navegador. Visitantes únicos = abas distintas. A mesma pessoa em duas abas conta duas vezes
  (escolha de privacidade: sem cookie não há como juntar abas).
- **Membro ativo 7d / 30d**: contas distintas que abriram pelo menos uma página com login nos últimos 7 / 30 dias.
  Para isso o servidor guarda só (conta, dia) em `private.member_days`, sem página nem ação.
- **Contas criadas**: `auth.users.created_at` no período (fonte do servidor, não do navegador).
- **Deduplicação**: cada ação conta uma vez por página aberta (no navegador) e o mesmo evento da mesma aba em 3 s é descartado (no servidor);
  uma aba para de contar depois de 400 eventos no dia.
- **Quem não é contado**: administradores, navegadores automáticos (testes) e navegadores com "não rastrear" (DNT) ou Global Privacy Control.
- **Retenção**: 90 dias (eventos e dias de membro), apagados todo dia pelo cron `inkwell-trim-stats`.
- **Zeros**: o relatório lista os 9 eventos sempre; sem ocorrência aparece 0. Não há número simulado.
- **Seus dados**: os dias de uso vêm em "Baixar meus dados" e somem ao excluir a conta.
