# Validação do login real (código por e-mail)

Os testes automáticos do repositório usam um Supabase **simulado**: eles provam a lógica da página, não o login real.
Este roteiro valida o caminho real. Ele **grava dados reais** no Supabase de produção (uma conta nova, um deck, um perfil),
então use um e-mail de teste e apague a conta no fim (Perfil → Seus dados → Excluir conta).

Configuração atual (conferida em 01/11/2026 em Supabase → Authentication → Sign In / Providers → Email):
- **Email OTP Length: 8 dígitos.** O site aceita de 6 a 10 e nunca corta o código.
- **Email OTP Expiration: 1 hora.**
- E-mail: assunto "Seu código do Inkwell"; link para `https://inkwell.com.br/entrar/?h=…`.

## A. Deck sem cadastro → conta → deck salvo (computador)
1. Janela anônima. Abra o site → **Testar um deck sem cadastro** → **Experimentar com um deck de exemplo**.
   Esperado: cartas, "legal"/"ainda não legal", estimativa de custo.
2. Recarregue a página. Esperado: a lista continua lá (fica 1 dia neste navegador).
3. **Criar conta e salvar** → digite o e-mail de teste → **Enviar código**.
4. No e-mail: confira que o número de dígitos é igual ao "Email OTP Length".
5. **Código errado**: digite um número a menos e aperte Entrar. Esperado: "Esse código não vale…", o que você digitou continua no campo.
6. **Colar o código inteiro**: copie o código do e-mail e cole no campo. Esperado: entra sozinho, sem cortar dígitos.
7. Esperado depois de entrar: a mesma página Decks, com o aviso "Você tem uma lista de antes de entrar" e a janela de
   salvar **já aberta**. Dê um nome e **Salvar**. Esperado: o deck aparece na lista; o aviso some.

## B. Código expirado e reenvio
1. Saia da conta. **Entrar** → e-mail → **Enviar código**. Espere passar a validade do código (1 hora).
2. Digite o código vencido. Esperado: "Esse código não vale: está errado, expirou ou já foi usado".
   (Sem esperar 1 hora: peça um segundo código e tente o primeiro; o esperado é o mesmo aviso.)
3. Espere o contador de 60 s → **Mandar outro código**. Esperado: "Mandamos um código novo"; o campo fica vazio.
4. Use o código **novo**. Esperado: entra. (O código antigo não deve mais funcionar.)

## C. Link do e-mail aberto em outra aba
1. Saia. Janela anônima → **Criar meu perfil** → preencha nome, tintas e uma carta → **Criar conta e salvar** → e-mail.
2. No e-mail, **toque no link** ("Ou toque aqui para entrar") em vez de usar o código. Abre outra aba em /entrar/.
3. Na aba nova: aperte **Entrar no Inkwell**. Esperado: ela volta para "Criar meu perfil" e diz
   "Volte para a aba onde você começou para salvar suas alterações" — a aba original salva (só uma salva).
4. Volte à aba original. Esperado: ela recarrega sozinha, já com conta, e salva o perfil (perfil começa **privado**).
5. Repita, mas **feche a aba original** antes de tocar no link. Esperado: a aba nova salva o perfil
   (o rascunho fica neste navegador por 1 dia).

## C2. Deck com o link em outra aba
1. Repita A até o passo 3 e, no e-mail, use o **link** em vez do código.
2. Na aba nova: **Entrar no Inkwell**. Esperado: volta para Decks, com a lista e a janela de salvar já abertas
   (a lista fica no navegador por 1 dia, então as duas abas a enxergam).

## D. Celular (iPhone e Android)
1. No celular, faça o roteiro A.
2. Com o e-mail no **app Mail da Apple** (iOS 17+): ao tocar no campo do código, o iPhone deve sugerir o código acima do teclado.
   Tocar na sugestão deve entrar sozinho. No app do Gmail/Outlook não há sugestão: copie e cole (também entra sozinho).
3. Faça o roteiro C abrindo o link pelo app de e-mail. Se o link abrir dentro do app de e-mail (navegador interno),
   a sessão **não** chega ao Safari/Chrome: use o código. Anote o que aconteceu.
4. Confira que tocar nos campos não dá zoom na página.

## O que anotar
Para cada passo: aparelho, navegador, app de e-mail, tamanho do código, resultado esperado × real, captura de tela se falhar.

## P0 #145 — teste real com conta de teste (antes da aprovação final)

Quem executa: uma pessoa com acesso a uma caixa de e-mail de teste (ex.: um alias só para isso). Não colar código, link do
e-mail, token nem print da caixa de e-mail em lugar nenhum (issue, PR, chat). Anotar só PASS/FAIL e o horário de cada passo.

Pré-requisito: `supabase/metrics_p0.sql` rodado no SQL Editor (é compatível com o site atual: `track()` tem a mesma assinatura).

| # | Passo (celular, aba anônima) | Esperado |
|---|---|---|
| R1 | inkwell.com.br → "Testar um deck sem cadastro" → "Experimentar com um deck de exemplo" | 60/60, legal, estimativa com fonte e data |
| R2 | "Criar conta e salvar" → e-mail de teste → "Enviar código" | e-mail chega (assunto "Seu código do Inkwell") |
| R3 | Digitar 7 dígitos e "Entrar" | "Esse código não vale…"; o que foi digitado continua; não entrou |
| R4 | Colar o código inteiro | entra sozinho; volta a Decks com a lista e a janela de salvar abertas |
| R5 | Dar um nome e "Salvar" | o deck aparece na lista |
| R6 | Recarregar; voltar/avançar; sair (menu da conta) e entrar de novo com novo código | o deck continua lá |
| R7 | "Criar meu perfil" → nome + tinta → salvar | "Seu Inkwell foi salvo", perfil privado |
| R8 | Perfil → Seus dados → "Baixar meus dados" | arquivo tem o deck e `active_days` com o dia de hoje |
| R9 | Perfil → Seus dados → "Excluir conta" (digitar EXCLUIR) | conta apagada |

Depois de R9, o desenvolvedor confere no banco, só com contagens e sem expor dados: nenhuma linha da conta de teste ficou
(`auth.users`, `inkwell_profiles`, `profiles`, `private.member_days`), e em `admin_metrics` aparecem os eventos
`try_deck_started`, `deck_sample_loaded`, `signup_started`, `signup_completed`, `deck_saved`, `profile_started`, `profile_saved`
no horário do teste. Antes do merge do PR #147 o site publicado ainda envia os nomes antigos (somados aos novos no relatório);
`try_deck_started` e `signup_completed` só aparecem depois do merge — repetir R1–R5 nessa hora. Itens com BLOCKED não contam como aprovado.
