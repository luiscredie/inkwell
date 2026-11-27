# Publicação do site e recuperação

Como o inkwell.com.br é publicado, o que impede que algo não aprovado entre no ar, e o que fazer quando algo dá errado,
enquanto o repositório tiver **uma única pessoa com acesso** (luiscredie).

## 1. Como uma versão entra no ar

1. Um PR passa pelos quatro checks obrigatórios (js, python, smoke, journeys-webkit) e entra na main pela proteção normal.
2. O push na main dispara "Inkwell release checks" (`validate.yml`).
3. Quando esses checks terminam com sucesso, "Deploy Inkwell to GitHub Pages" (`deploy-pages.yml`) roda sozinho:
   - **build:** confere pela API, com o script `tools/verify-workflow-run.sh` vindo da main, que a execução de origem é:
     - o "Inkwell release checks" oficial;
     - de um **push na main deste repositório**;
     - do mesmo commit;
     - com os quatro jobs aprovados;
     - e que esse commit está na main.

     Depois monta o site **daquele commit** e envia o artefato.
   - **deploy:** é o único job com permissão de publicar (`pages`, `id-token`). Ele publica o artefato.

Nada de PR, fork ou branch é publicado. Os testes `tools/deploy-workflow.test.mjs` (o encadeamento dos jobs) e
`tools/verify-deploy.test.mjs` (os scripts, com a API do GitHub simulada) rodam em todo PR.

**Conferir o que está no ar:**
- no run de deploy, job **build**, passo "Check out revision": a linha `HEAD is now at <sha>` mostra o commit publicado;
- o rótulo do run na lista do GitHub mostra o topo da main quando o run começou, que pode ser um commit mais novo, ainda não publicado.

## 2. Se o deploy automático falhar

- **Falha do GitHub no deploy** (por exemplo "Found 0 artifact(s)", erro 500 da API do Pages): no run, use
  **Re-run failed jobs**. Ele refaz só o job que falhou, com o mesmo artefato e o mesmo commit.
- **Falha no build:** investigar antes de qualquer nova tentativa. Não use o disparo manual para contornar.
- **Os checks da main falharam:** nada foi publicado, e o site continua na última versão aprovada. Corrija com um novo PR.

## 3. Disparo manual (Actions → Deploy Inkwell to GitHub Pages → Run workflow)

- Só a partir da main.
- Só o **topo da main**, com o SHA completo, aprovado pelos quatro checks na execução oficial.
- Serve para republicar a versão atual quando o automático não pode ser refeito.

## 4. Rollback: bloqueado hoje, de propósito

Publicar um commit **anterior** ao topo da main exige três coisas:
1. autorização escrita;
2. o SHA digitado de novo;
3. a aprovação de **outra pessoa** no ambiente protegido `rollback`. Esse ambiente tem revisor obrigatório,
   "Prevent self-review" ligado, sem bypass de administradores e só a main.

Como o único revisor (luiscredie) é também quem dispara, **nenhum rollback pode ser aprovado**. Isso é intencional:
`tools/verify-rollback-approval.sh` recusa uma aprovação de quem disparou, com qualquer combinação de maiúsculas e
minúsculas, e falha fechado se o ambiente, o revisor ou a regra faltarem.

Não afrouxe o ambiente para destravar um rollback: não desligue "Prevent self-review", não ligue o bypass e não remova
o revisor.

## 5. Recuperação segura sem segundo revisor: corrigir para a frente

Quando uma versão publicada tem um problema:

1. Abra uma branch a partir da main e reverta o(s) commit(s) com defeito:
   `git revert <sha>` (para um merge: `git revert -m 1 <sha>`).
2. Abra o PR. Ele passa pelos quatro checks como qualquer outro.
3. Com autorização, faça o merge. O deploy automático publica o commit de reversão, que é o novo topo da main.
   Não é um rollback: é uma versão nova, testada.
4. Confira o commit publicado (seção 1) e faça o smoke do site.

Tempo típico: o tempo dos checks do PR mais o dos checks da main (~10–20 min) e o do deploy (~3 min).

**O que não fazer:**
- disparar o workflow manual com um SHA antigo (é recusado);
- usar bypass da proteção da main;
- editar o site direto na branch do Pages;
- apagar runs.

## 6. Quando houver um segundo revisor

Adicionar a pessoa como colaboradora e como revisora do ambiente `rollback` (decisão do Conselho). A partir daí:
- o rollback disparado por luiscredie pode ser aprovado por ela;
- um rollback disparado por ela precisa da aprovação de luiscredie.

Os scripts não mudam.
