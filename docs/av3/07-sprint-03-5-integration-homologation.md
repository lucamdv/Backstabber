# AV3 · Sprint 03.5 — Integração e homologação

**Estado: bloqueada para cutover.** A API foi integrada e exercitada com PostgreSQL isolado na Sprint 03.4. A evidência local cobre as regras, a API e as transações. A homologação gerenciada depende de um projeto Supabase independente, de hospedagem e de contas de teste autorizadas.

## Infraestrutura

| Recurso | Destino de staging | Estado |
| --- | --- | --- |
| React | Projeto Vercel separado ou configuração exclusiva da branch em um projeto de staging | O inventário mostrou apenas o projeto Vercel histórico do Backstabber. Nenhum preview AV3 foi provisionado. |
| Spring Boot 4.1.2 | Serviço HTTPS em Railway, com Docker como contrato de deploy | Dockerfile preparado com bases Java 21 fixadas por digest. Na preparação inicial o Docker Engine local estava indisponível. Na retomada, o build foi validado no Docker Desktop. Nenhum serviço provisionado. |
| Auth, PostgreSQL e Realtime | Um projeto Supabase dedicado à Sprint 03.5 | O projeto existente com nome de homologação tem o identificador de produção e está excluído. A tentativa de criação gratuita foi recusada pelo limite de dois projetos ativos. |

O Railway Hobby parte de US$ 5/mês, com créditos incluídos e cobrança de excedente por uso. O Railway Free é uma opção para experimentação com franquia mensal limitada. O Render é a alternativa de Docker, com instância gratuita que adormece após 15 minutos sem tráfego e pode reiniciar. Registre memória, latência e tempo de retorno antes de escolher o plano para um ensaio sustentado. O Supabase Free pode pausar projetos inativos e limita a conta a dois projetos ativos. Nenhum recurso pago foi criado. [Railway](https://docs.railway.com/pricing) · [Render](https://render.com/docs/free) · [Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)

## Configuração e execução

1. Depois de obter um projeto explicitamente aprovado, confirme a referência no painel e registre-a em BACKSTABBER_STAGING_PROJECT_REF. O perfil homologation valida a origem de Auth e o host direto de PostgreSQL ou o usuário qualificado no pooler antes de criar o datasource. A referência de produção é rejeitada de forma explícita. Origem customizada ou proxy sem vínculo verificável deve aguardar uma configuração identificável.
2. Confira a estrutura do projeto aprovado e aplique somente a migration canônica 20261112000101_backstabber_multiplayer.sql no PostgreSQL de staging. Verifique políticas, privilégios e triggers. Configure a URI e o CA no serviço de deploy. O Java usa verify-full. Para rede sem IPv6, prefira o pooler em modo sessão na porta 5432 com o usuário postgres.<ref>, sem gravar a senha no Git. [Conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. No serviço Java, aponte o contexto de build para backend/. Execute docker build -t backstabber-java-staging backend a partir da raiz do repositório. No provedor, mantenha SPRING_PROFILES_ACTIVE=homologation. A porta vem de SERVER_PORT ou PORT, com padrão 8080. Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DATABASE_URL, SUPABASE_DB_CA_CERT e BACKSTABBER_ALLOWED_ORIGIN. Use /actuator/health/liveness para verificar o processo e /actuator/health/readiness para a implantação dependente do banco. [Healthchecks Railway](https://docs.railway.com/guides/healthchecks)
4. No projeto Vercel isolado, configure no build VITE_SUPABASE_URL e a chave pública do mesmo projeto e VITE_API_URL=https://<api-java-staging>/api/v1. Use uma origem estável HTTPS. Confirme no navegador o host real da API em cada chamada e no preflight. A lista CORS deve conter somente a origem exata do frontend autorizado. Reconstrua o bundle após qualquer ajuste VITE_*.
5. No cliente OAuth Google dedicado, cadastre https://<ref-staging>.supabase.co/auth/v1/callback. No Supabase de staging, configure o Site URL e permita os retornos https://<frontend-staging>/?online=amigos e https://<frontend-staging>/?online=salas. Ajuste para os caminhos reais se houver prefixo e inclua as contas consentidas na lista de usuários de teste do Google. Insira o Client Secret diretamente no painel de staging. O callback Google aponta ao Supabase e a última navegação retorna à origem Vercel. [Google OAuth no Supabase](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)

Para testar o Node de referência, use um frontend com o mesmo commit apontando para o Node em staging. Execute os roteiros em salas e perfis de teste separados. Não alterne a API de uma mesma execução salvo no teste explícito de compatibilidade. Os exemplos de URL representam espaços a preencher com os endereços provisionados.

## Roteiro de aceite gerenciado

- Confirme os dois destinos de servidor pelo identificador aprovado e o frontend pelo host observado em rede. Verifique TLS, preflight, erro sem token e origem CORS rejeitada. Registre somente o identificador da execução e status HTTP. Nunca exporte headers de autenticação, HAR bruto ou arquivos de storage state.
- Use três contas reais autorizadas em contextos independentes. Verifique Google OAuth, retorno, atualização de perfil, refresh, logout, expiração, troca de conta e recarga. Guarde eventuais arquivos .auth localmente. Execute BACKSTABBER_E2E_URL=<frontend-staging> e BACKSTABBER_E2E_USERNAMES=<três usernames de teste> com npm run test:e2e -- --grep @live para o cenário existente. Complete pelo navegador os cenários adicionais de ação, bloqueio e contestação do briefing.
- Teste fluxo de amizade, presença, convite, prontidão, partida, renda, patrocínio, taxa, contestação, bloqueio, extorsão, Executor, Broker, perda, Backstab, eliminação, vitória e revanche. Inspecione o snapshot de cada sessão para confirmar isolamento de cartas e escolhas, e tente acessar a sala por sessão externa.
- Confirme que os canais privados user:<id> e room:<id> recebem apenas invalidações e presença conforme a função. Teste recusa de inscrição de terceiros, reconexão do canal e atualização após a reconexão. Repita o envio de comando previamente aceito e confirme a revisão e a ausência de invalidação extra. [Broadcast Supabase](https://supabase.com/docs/guides/realtime/broadcast)
- Interrompa separadamente navegador, Realtime, API e PostgreSQL de staging em janela dedicada. Meça o retorno do mesmo snapshot e revisão, oferta, votos, créditos e janela de abandono. Faça um ensaio de reinício e reprise de confirmação perdida. Compare com Node nas mesmas condições.
- Registre startup, CPU, RSS, pool ativo e pendente, p50/p95 de Auth, snapshots, comandos e votos, e tempo de recuperação. Separe cold start de regime estável. Compare o mesmo volume com Node. Comece com três jogadores e uma partida, monitore o plano e só amplie a carga no ambiente aprovado.

## Regressão local

- Maven clean verify passou em 95 testes Java na execução sequencial, incluindo os três casos de isolamento, 13 casos HTTP de partida e a recuperação de sete checkpoints em outro processo. Na primeira execução concorrente, o subprocesso de recuperação excedeu o limite de startup de 30 s e o teste falhou. Nenhum timeout foi alterado. No PostgreSQL 17.11 descartável, a paridade de partida voltou a comparar 103 respostas HTTP, 36 fingerprints textuais e 38 estados JSONB por roteiro. A paridade social comparou 35 respostas HTTP.

- Typecheck, lint e build do frontend passaram. O Vitest padrão teve 119 testes aprovados e oito de PostgreSQL omitidos na execução padrão. Os oito passaram na repetição sequencial com o PostgreSQL local após duas tentativas, uma com timeout no setup e outra com timeout de conexão. O build repetiu o aviso de tamanho do bundle.
- Playwright com gravações teve 46 aprovados, três falhas e um teste real omitido. O Backstab piloto excedeu 45 s e o log mostrou interrupção no fechamento do contexto. O Backstab online foi observado por 2.002 ms frente ao mínimo de 2.300 ms. O cenário de presença em 360×800 registrou deslocamento vertical de 24 px. Uma execução anterior foi invalidada por variável de URL presente com valor vazio e tentativa de navegação relativa sem origem, corrigida no comando de teste.
- A instrumentação isolada com o Vite local aquecido e recursos externos bloqueados observou os dois timers por aproximadamente 2.505 ms sem vídeo. Com vídeo, mediu o piloto em 2.500 ms e o online em 2.506 ms. Os contextos gravados fecharam em 350 ms e 198 ms, respectivamente. A falha ocorreu na suíte integral. A medição isolada mostra que o timer e o intervalo observado no DOM são medidas diferentes. A causa exata da intermitência e do deslocamento permanece em aberto. Nenhuma asserção, regra ou animação foi alterada.

- Após separar o Playwright dos testes de backend, os três casos com falhas anteriores passaram isoladamente e na suíte completa. A nova execução integral levou 4,2 minutos, com 49 aprovados, zero falhas e um cenário omitido por exigir três contas reais. As falhas anteriores não foram reproduzidas nessa rodada e a causa da intermitência permanece desconhecida.

## Ensaio local com Docker no Windows

O terminal restrito devolveu Wsl/E_ACCESSDENIED e negou acesso ao named pipe do Docker. Fora da restrição, WSL 2.7.14 com distribuição docker-desktop em WSL 2 e Docker Engine Linux 29.8.0 responderam. Os outros containers da máquina ficaram fora do ensaio. Se o servidor não responder em um terminal normal, verifique wsl --status e wsl --list --verbose, abra Docker Desktop com o engine WSL 2 e repita docker version. Use wsl --update se a versão instalada estiver abaixo do requisito documentado. [Docker Desktop com WSL 2](https://docs.docker.com/desktop/features/wsl/) · [WSL no Windows](https://learn.microsoft.com/windows/wsl/install)

O primeiro build revelou que o Maven Wrapper troca o ZIP por TAR.GZ quando unzip está ausente. O SHA-256 registrado é o do ZIP. O estágio de build agora instala unzip e mantém a validação original. O build passou com Maven Wrapper 3.9.11. No contêiner final, Java 21.0.13 rodou como UID 10001 e /app continha apenas app.jar. A inspeção da imagem não encontrou variáveis de aplicação com credenciais. Sem configuração de staging, o perfil padrão homologation recusou o boot em uma rede desativada.

A partir da raiz, com Docker ativo e o projeto local sem vínculo remoto

```powershell
docker build -t backstabber-java-local backend
npm exec --yes --package supabase@3.1.0 -- supabase start --help
docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 backstabber-local-loopback
npm exec --yes --package supabase@3.1.0 -- supabase start --network-id backstabber-local-loopback --exclude storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

A stack reutiliza supabase/config.toml e aplica a migração canônica na inicialização de um banco local novo. O health_timeout local foi ajustado para 5 min após o primeiro cold start do PostgreSQL exceder o prazo durante initdb. A checagem de saúde permanece ativa. Confirme pelo status da CLI os endpoints locais do gateway na porta 54321 e do banco na 54322. Confira as portas efetivamente publicadas com docker ps e use somente endereços de loopback no Spring e no React. Neste Windows, a CLI publicou portas em todas as interfaces apesar do ajuste do bridge. Encerre a stack de teste ao terminar. Mantenha as chaves, a URI local e os arquivos de sessão fora do Git. [CLI e stack local](https://supabase.com/docs/guides/local-development/cli/getting-started)

Para iniciar o JAR no host, use o perfil dev, SERVER_PORT=18085, SUPABASE_URL=http://127.0.0.1:54321 e a DATABASE_URL e chave pública do status exclusivamente local. Autorize a origem http://127.0.0.1:4253 em BACKSTABBER_ALLOWED_ORIGIN. No frontend, defina VITE_SUPABASE_URL com a mesma origem de Auth, VITE_SUPABASE_PUBLISHABLE_KEY com a chave local e VITE_API_URL=http://127.0.0.1:18085/api/v1. Gere novo build e execute o Vite Preview em 127.0.0.1:4253. Para o contêiner, o ensaio local pode usar uma rede Docker própria e encaminhamentos de loopback exclusivos para gateway e banco daquela rede. Mantenha o perfil homologation para staging e execute containers locais de teste explicitamente com dev e publicação em loopback.

Com os dois servidores locais prontos, informe somente a chave pública local em BACKSTABBER_LOCAL_SUPABASE_KEY e execute a partir de web/. O roteiro cria três usuários de teste via e-mail e senha no Auth local e grava as sessões em .auth, ignorado pelo Git. Preserve ou mova sessões já existentes antes de começar.

```powershell
$env:BACKSTABBER_E2E_URL = 'http://127.0.0.1:4253'
$env:BACKSTABBER_E2E_USERNAMES = node e2e/local-supabase.mjs
if ($LASTEXITCODE -eq 0) { npm run test:e2e -- --grep '@live' }
```

O roteiro HTTP cobre os perfis e o isolamento de canais privados e partidas. O teste de navegador usa as sessões locais para validar o fluxo React, incluindo reconexão, vitória e revanche. O provedor Google local fica desabilitado por padrão. [Configuração e evidência do OAuth local na Sprint 03.5B](09-sprint-03-5b-google-oauth-local.md)

No ensaio, o primeiro boot excedeu o timeout de PostgreSQL. A tentativa seguinte aplicou a migração, mas a CLI encerrou a stack quando o PostgREST retornou 503 durante a inicialização. A terceira usou o argumento suportado --ignore-health-check para deixar os serviços terminarem de subir, com verificação explícita antes dos testes. PostgreSQL 17.11 confirmou a migração, Auth retornou HTTP 200, Realtime ficou saudável e o React compilado respondeu em loopback. O Spring respondeu HTTP 200 em liveness e readiness no JAR do host e no contêiner com o PostgreSQL local. Com o banco indisponível, a readiness do contêiner retornou 503.

O roteiro HTTP passou com três usuários distintos criados e autenticados por e-mail e senha somente no Auth local. Validou perfis, amizade, convite, prontidão, bloqueio do Patrocínio, oferta privada do Broker, Backstab, perda, vitória e revanche. A primeira partida terminou o roteiro na rodada 2, revisão 53. Terceiros foram recusados nos canais privados de usuário e sala e na API de partida. O papel autenticado também teve a leitura direta de bs_matches recusada pelo PostgREST. Realtime entregou invalidações de sala e sociais. A versão local do serviço incluiu um UUID de transporte além de kind, sem conteúdo privado da partida.

No Playwright integrado, os três contextos de navegador participaram da mesma sala pelo React compilado. O roteiro verificou amizade, entrada por convite e código, prontidão, mãos distintas, contestação após reconexão, vitória e revanche. O cenário passou em 1,5 min (2,2 min na execução inteira) e a partida chegou à rodada 2 na revisão 164. Na primeira tentativa o teste atingiu a asserção de amigos durante o carregamento. O roteiro agora sincroniza a navegação com as respostas de amigos e convites antes da mesma asserção visual.

A regressão desta retomada passou em 36 testes Java direcionados, além de typecheck, lint e build React com configuração local. O Vitest inicialmente passou em 118 testes e teve um timeout de 5 s no caso de transições de presença. O teste repetido durante a inicialização do Docker voltou a exceder o limite. A última repetição, isolada após encerrar a stack, passou sem alteração no timeout.

## Evidência de aceite

O ensaio local usou três identidades de teste do Supabase local. Nenhum teste gerenciado foi executado, nenhuma conta Google real participou e não há URL de staging AV3. Ausência local de DATABASE_URL e SUPABASE_URL foi confirmada antes da configuração de fixtures. As suítes automatizadas de backend usam PostgreSQL descartável e Auth sintético. O ensaio integrado usa Auth e Realtime reais da stack local. OAuth, entrega WebSocket gerenciada, comparação E2E com contas, resiliência remota e métricas de infraestrutura continuam pendentes. A aprovação do proprietário é um gate separado, conforme o [plano de cutover e rollback](08-production-cutover-rollback.md).
