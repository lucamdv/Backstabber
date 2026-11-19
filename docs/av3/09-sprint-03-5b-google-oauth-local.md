# Sprint 03.5B · Google OAuth local

## Fluxo auditado

O React inicia `signInWithOAuth` com Google e usa PKCE, persistência de sessão, detecção do código na URL e refresh automático. O Google retorna ao gateway Supabase em `http://127.0.0.1:54321/auth/v1/callback`. O Supabase então redireciona ao React em `http://127.0.0.1:4253/`, com `online=amigos` ou `online=salas` e o código PKCE. Um código de convite em `sala` acompanha o retorno. O SDK usa o verificador salvo na origem do React antes de o app limpar a URL. Mantenha `127.0.0.1` desde a primeira navegação até o retorno, pois o armazenamento do verificador depende da origem. [Google no Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)

O React envia a sessão do Supabase em `Authorization: Bearer` para o Spring. O backend consulta `/auth/v1/user` na instância configurada e usa o UUID do usuário autenticado. Em HTTP 401, o cliente web tenta renovar a sessão e repete a requisição uma vez com o token atualizado. O logout é da sessão local do Backstabber, enquanto a sessão do navegador no Google segue independente.

## 1. Autorizar o loopback no cliente Google existente

1. No Google Cloud Console, abra **Google Auth Platform → Clients** e selecione o cliente **Web application** que o Backstabber já usa.
2. Acrescente `http://127.0.0.1:4253` em **Authorized JavaScript origins** e `http://127.0.0.1:54321/auth/v1/callback` em **Authorized redirect URIs**. Preserve todos os endereços existentes e as configurações de consentimento e escopos. O React retorna pelo `site_url` do Supabase local. [Validação de redirecionamentos do Google](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)
3. Use o Client ID e o Client Secret existentes apenas no processo local do Supabase. Mantenha os valores fora de arquivos versionados, logs, capturas e variáveis `VITE_*`.

## 2. Subir somente em loopback

Use a stack Docker local e um terminal PowerShell na raiz. O provedor Google vem desabilitado para que o ensaio com usuários de e-mail funcione sem credenciais Google.

1. Se já houver uma stack local desta pasta em execução, encerre-a com `npx --yes --package supabase@3.1.0 -- supabase stop`. Rode o comando abaixo na raiz. O script usa `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` do terminal ou pede os valores localmente com o Secret mascarado. Ele habilita Google durante a inicialização da CLI, restaura o arquivo para o padrão desabilitado e verifica se o provedor está ativo na instância que acabou de subir.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-google-oauth.ps1
   ```

2. Use o status **local** da CLI para obter a chave pública e a URI do PostgreSQL. Antes de iniciar o backend, confirme Auth em `http://127.0.0.1:54321` e PostgreSQL em `127.0.0.1:54322`. A URI contém uma senha local. Leia os valores no terminal sem incluí-los no relatório.
3. Inicie o JAR no perfil `dev` com `SERVER_PORT=18085`, `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_PUBLISHABLE_KEY` e `DATABASE_URL` do status local e `BACKSTABBER_ALLOWED_ORIGIN=http://127.0.0.1:4253`. Confirme HTTP 200 em `http://127.0.0.1:18085/actuator/health/readiness`. O ensaio usa o perfil e o banco locais. [Comandos de build e stack local](07-sprint-03-5-integration-homologation.md#ensaio-local-com-docker-no-windows)
4. Em `web/`, execute `npm run build` com `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave pública do status local e `VITE_API_URL=http://127.0.0.1:18085/api/v1`. Suba o build com `npm run preview -- --host 127.0.0.1 --port 4253 --strictPort`.
5. Ao concluir, encerre o Preview e o Spring e use `npx --yes --package supabase@3.1.0 -- supabase stop` na raiz. Confirme `enabled = false` no bloco `[auth.external.google]`. Confira as portas publicadas pelo Docker, principalmente em rede compartilhada.

## 3. Validar com contas autorizadas

1. Em uma janela de navegador comum, abra `http://127.0.0.1:4253/#/amigos`, use **Entrar com Google** e conclua o consentimento. Registre os endereços sem os parâmetros sensíveis, o callback local, o status 200 de `/auth/v1/token?grant_type=pkce` e o retorno para `#/amigos` com a URL limpa. Repita a partir de **Salas** ou de um link de convite e confira o destino.
2. No painel Network, confirme HTTP 200 em `GET /api/v1/profile` depois do login. Crie o perfil se necessário e recarregue a página para verificar a persistência. Mantenha a aba aberta e em primeiro plano até o refresh automático e confirme HTTP 200 em `/auth/v1/token?grant_type=refresh_token` e em nova consulta protegida. Para abreviar, pode usar temporariamente `jwt_expiry = 300` em `[auth]` antes de iniciar a stack e remover a alteração ao final.
3. Use **Sair** e recarregue para confirmar que a tela volta a pedir autenticação. Uma chamada ao Spring sem token deve retornar HTTP 401. Registre apenas rótulos e status HTTP, sem salvar tokens, cookies, código OAuth, HAR ou e-mails.
4. Com três contas autorizadas, abra três perfis de navegador independentes e repita o login. Crie os três perfis do jogo, adicione os amigos, envie convite, entre na sala, marque prontidão e conclua a partida. Exercite votação, bloqueio, reconexão e revanche. Confira que cada perfil vê apenas sua própria mão. Registre a rodada e a revisão finais, se disponíveis, com as contas identificadas apenas como A, B e C.

## Pré-teste automatizado

Com a stack local, o frontend compilado e o provedor habilitado, rode em `web/`:

```powershell
$env:BACKSTABBER_E2E_URL = 'http://127.0.0.1:4253'
$env:BACKSTABBER_LOCAL_OAUTH_PREFLIGHT = '1'
npm run test:e2e -- --grep '@local-oauth'
```

O Playwright usa o React real, verifica o desafio PKCE S256 e primeiro redirecionamento emitido pelo Auth local, e interrompe a navegação antes do Google. O pré-teste aceita valores fictícios no provedor para exercitar somente essa parte.

## Evidência confirmada da Sprint 03.5B

- O Playwright passou em dois cenários contra o React compilado e o Supabase local. Amigos e Salas com convite geraram `code_challenge_method=s256` e preservaram o destino. O Auth emitiu o redirecionamento para o Google com o callback exato em `127.0.0.1:54321`. O teste reteve o redirecionamento e usou valores fictícios para o cliente.
- O Supabase Auth local e a readiness do Spring retornaram HTTP 200. Uma identidade fictícia de e-mail e senha obteve HTTP 200 no perfil do Spring antes e depois da rotação do refresh token. O logout removeu a sessão e uma tentativa de renovar com o último refresh token foi recusada. A chamada direta ao perfil sem token retornou HTTP 401.
- Typecheck, lint e build React passaram. O build manteve o aviso de tamanho do bundle. O Vitest passou em 119 testes, com oito cenários de PostgreSQL omitidos na configuração padrão.
- Os nove testes Java de HTTP/Auth e isolamento passaram em modo offline com acesso ao loopback. A primeira execução encontrou uma restrição do sandbox ao iniciar a fixture HTTP local.

### Login Google real em Amigos

- O usuário concluiu o login com uma conta Google no navegador, voltou ao React e visualizou o perfil em Amigos. O Supabase Auth local registrou `GET /callback` HTTP 302 e `POST /token` com `grant_type=pkce` HTTP 200. O banco local passou de zero para uma identidade Google, com uma sessão associada. O log do Spring registrou `GET /api/v1/profile` HTTP 200 após o login. A mesma rota retornou HTTP 401 sem token.
- A readiness da API Java retornou HTTP 200. O build React apontou para a API Java em `127.0.0.1:18085` e para o Auth em `127.0.0.1:54321`. O preflight CORS aceitou a origem do React em `127.0.0.1:4253` e recusou uma segunda origem. Os dois pré-testes Playwright foram repetidos com o Auth local habilitado e passaram.
- O Windows PowerShell 5.1 reproduziu `NativeCommandError` ao tratar uma mensagem de progresso em stderr como falha mesmo com código de saída 0. O teste do script corrigido aceitou stderr com saída 0, recusou código 7 e verificou a restauração do TOML e do ambiente nos dois casos. O login real usou o Supabase local já iniciado.
- Após a janela de teste, os contêineres do Supabase local foram encerrados e o gateway deixou de responder em `127.0.0.1:54321`. O arquivo `supabase/config.toml` manteve Google desabilitado por padrão.

## Retomada final das pendências

O ambiente foi reiniciado com o cliente Google existente e as credenciais fornecidas exclusivamente ao processo local. A verificação dos endereços confirmou Auth em `127.0.0.1:54321`, PostgreSQL em `127.0.0.1:54322`, Spring em `127.0.0.1:18085` e React em `127.0.0.1:4253`. A readiness do Java retornou HTTP 200. O bundle do React apontou para esses serviços e o preflight CORS aceitou a origem local autorizada, recusando uma segunda origem.

Uma página temporária na mesma origem do React disponibilizou renovação explícita com o SDK e consulta ao perfil Java. Os resultados foram apresentados sem valores de tokens, códigos OAuth, cookies, credenciais ou dados da conta. A duração padrão do JWT foi preservada.

| Verificação | Evidência obtida | Resultado |
| --- | --- | --- |
| Login real e retorno PKCE | Uma resposta `GET /callback` HTTP 302 e uma `POST /token` com `grant_type=pkce` HTTP 200 na janela desta rodada. | Confirmado pelos registros locais. |
| Sessão Google aceita pelo Java | Quatro respostas `GET /api/v1/profile` HTTP 200 durante a rodada. | Confirmado pelos registros locais. |
| Refresh de sessão Google | Uma `POST /token` com `grant_type=refresh_token` HTTP 200. | Renovação confirmada pelos registros locais. |
| Logout | Uma `POST /logout` HTTP 204. A contagem agregada de sessões Google criadas nesta janela terminou em zero. | Encerramento da sessão confirmado. |
| API sem sessão | Duas respostas HTTP 401 ao perfil, incluindo a consulta de referência anterior ao teste manual. O usuário também informou HTTP 401 no teste de logout. | Recusa de acesso sem sessão confirmada. |
| Persistência após F5 e recarga após logout | O usuário informou que o conjunto de testes aparentou o comportamento esperado e recordou respostas 200 e 401, sem discriminar essas duas etapas. | Relato manual geral. Falta confirmação isolada das recargas. |
| Nova autenticação após logout | A janela registrou uma única troca PKCE real. | Pendente de confirmação. |
| Entrada real por Salas e preservação de convite | Os dois pré-testes automatizados verificaram a construção do retorno e do convite fictício `11111ABC12`, interceptando a navegação antes do Google. O relato manual foi geral. | Pré-testes confirmados. Falta evidência individual dos retornos Google reais. |

Os registros foram consultados com projeção apenas de método, caminho sem query string, status HTTP, tipo de grant e contagens. A consulta ao PostgreSQL local retornou somente agregados. O relatório usa a contagem de sessões criadas na janela do teste para distinguir o logout desta rodada de sessões locais anteriores.

### Regressão desta retomada

- Passaram 13 testes direcionados de `online-auth.test.tsx`, `online-api.test.ts` e `online-hub-flow.test.tsx`.
- A primeira rodada do Playwright teve um caso aprovado e um falho. O gateway retornou HTTP 504 em `/authorize` no caso Amigos, sem cabeçalho de redirecionamento. A repetição passou nos dois casos em 17,6 segundos. A causa do 504 inicial permanece sem diagnóstico conclusivo.
- O build React local foi concluído. Readiness, configuração do bundle e CORS foram verificados novamente.

## Testes pendentes

- Confirmar individualmente a persistência após F5, a recarga após logout, a nova autenticação e os retornos reais por Salas e pelo convite.
- Verificar refresh automático por expiração, caso seja desejada essa evidência adicional. A renovação da sessão Google por refresh token passou nesta rodada.
- A partida com três contas Google é evidência adicional opcional. O multiplayer com três identidades locais já está registrado no [relatório de integração local](07-sprint-03-5-integration-homologation.md#ensaio-local-com-docker-no-windows).

## Encerramento do ambiente desta rodada

O React, o Spring e os contêineres do Supabase local foram encerrados após a coleta. As portas HTTP 4253, 18085 e 54321 deixaram de responder, e o Engine confirmou a ausência de contêineres ativos do Backstabber. O arquivo de configuração manteve `[auth.external.google].enabled = false`, com Client ID e Secret referenciados por variáveis de ambiente. Os arquivos temporários da página de verificação foram removidos.
