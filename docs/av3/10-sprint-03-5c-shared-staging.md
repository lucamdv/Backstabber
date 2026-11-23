# Sprint 03.5C · Homologação com infraestrutura compartilhada

## Estado e limite da entrega

Preparação de código, migration proposta, rollback e testes exclusivamente locais. A aplicação no Supabase hospedado depende de aprovação explícita em uma etapa posterior. O plano usa o projeto Backstabber existente, o schema `bs_staging` e uma API Java HTTPS separada.

A [pré-aplicação e o checklist GO / NO-GO](11-sprint-03-5c-preflight.md) detalham o pacote SELECT-only e os gates de aprovação. A compatibilidade de grants e políticas do serviço gerenciado permanece não verificada. A permissão de gerenciar políticas em `realtime.messages` não comprova a capacidade de delegar INSERT nessa tabela. Nenhuma auditoria SQL hospedada foi executada nesta preparação.

## Isolamento dos dados e dos privilégios

| Camada | Produção existente | Homologação proposta |
| --- | --- | --- |
| Dados de jogo | `public.bs_*` | Oito tabelas novas e vazias em `bs_staging.bs_*` |
| Auth | Projeto Supabase existente | Mesmo Auth, com contas de teste autorizadas já existentes |
| SQL do Java | `BACKSTABBER_GAME_SCHEMA=public`, padrão | `BACKSTABBER_GAME_SCHEMA=bs_staging` |
| Credencial PostgreSQL | Credencial atual do backend existente | Login próprio `bs_staging_app` |
| Dono dos objetos de staging | Sem participação no fluxo de staging | `bs_staging_owner`, sem login |
| Realtime | `user:<uuid>`, `room:<uuid>` | `hml:user:<uuid>`, `hml:room:<uuid>` |
| Frontend | Configuração atual | Preview exclusivo da branch Java com `VITE_GAME_SCHEMA=bs_staging` |

Os perfis de jogo são independentes mesmo quando o UUID do Auth é o mesmo. A homologação cria seu próprio perfil em staging. A migration usa apenas uma chave estrangeira para `auth.users(id)`, sem copiar perfis, salas, partidas ou comandos existentes.

### Auditoria do Java

O SQL do jogo foi localizado em `ProfileReader`, `FriendshipRepository`, `InvitationRepository`, `RoomRepository` e `MatchRepository`. Todos agora recebem `GameJdbc`, que delega ao `JdbcClient` existente e qualifica as referências constantes `public.bs_*` pelo schema escolhido no início do processo.

`GameSchema` aceita somente `public` e `bs_staging`. Listas de schemas, outros nomes, espaços e fragmentos SQL são rejeitados. As queries preservam parâmetros vinculados, joins, transações e contratos HTTP. O datasource configura um único `currentSchema`, sem fallback para `public` em staging. `JdbcTemplate` permanece nas rotinas de limite de transação e saúde, sem consultas de jogo fora do roteamento.

Cada nova conexão de staging executa `bs_staging.assert_runtime_role()`. A função verifica o usuário efetivo, atributos administrativos, memberships, ownership, privilégios de tabela e coluna em relações `bs_*` fora do staging, acesso a `auth.users`, acesso à tabela Realtime e permissões de DDL. Uma concessão incompatível impede a conexão de entrar no pool.

### Migration e papel restrito

Proposta em `supabase/migrations/20261119000101_backstabber_shared_staging.sql`. A migration é transacional e recusa colisões com os nomes de schema e papéis. Replica as definições das oito tabelas canônicas, índices, constraints e chaves estrangeiras.

`bs_staging_app` recebe somente uso do schema e DML nas tabelas de staging, com políticas RLS próprias. O login nasce com senha nula e precisa de uma senha exclusiva fornecida fora do Git após aprovação. Ele não é dono dos objetos, não recebe memberships e não possui CREATE, TRUNCATE, TRIGGER, privilégios administrativos ou escrita no Auth.

`bs_staging_owner` possui os objetos novos e os triggers, sem login. Recebe somente a referência de FK a `auth.users(id)` e a ponte de publicação de invalidações. O executor administrativo não-superusuário mantém a associação ADMIN-only que o PostgreSQL cria automaticamente para o criador desses dois papéis, com INHERIT e SET desabilitados ao final. Essa capacidade permite configurar a senha e executar o rollback. O superusuário usado no fixture descartável já possui capacidade administrativa intrínseca. A administração dos papéis novos deve constar na aprovação. [Papéis no PostgreSQL 17](https://www.postgresql.org/docs/17/role-attributes.html)

Os privilégios herdados de `PUBLIC` são verificados. Se eles derem ao novo papel acesso incompatível, a proposta falha sem alterar as concessões ou políticas existentes da produção. O teste usa os OIDs dos objetos para consultar privilégios sem conceder acesso aos schemas protegidos.

Administradores privilegiados do projeto continuam tendo capacidade administrativa sobre os dois schemas. A separação protege o papel de execução da homologação e os caminhos de dados das aplicações. Infraestrutura, Auth, capacidade e administração do projeto seguem compartilhados.

### Realtime

Os triggers são funções de staging com `SECURITY DEFINER`, `search_path` vazio e referências qualificadas. O papel do Java não pode executar diretamente esses triggers nem publicar mensagens por uma credencial administrativa.

O Supabase local usa `realtime.send` com permissões do chamador. Por isso, a proposta concede INSERT em `realtime.messages` exclusivamente ao dono sem login, com uma política adicional que aceita apenas invalidações privadas `hml:` e os formatos esperados. A política permite o UUID de transporte que o serviço acrescenta ao payload. O papel `bs_staging_app` continua sem privilégios de dados nessa tabela.

As novas políticas de clientes permitem o canal individual correspondente ao usuário autenticado e canais de sala com membership de staging. Presença exige membership. Publicações arbitrárias de broadcast pelo cliente são recusadas. Guardas restritivas limitadas a tópicos `hml:` impedem que uma política permissiva externa abra esses canais. Nos demais tópicos, os guardas são neutros. As definições das políticas de produção são preservadas.

## Configuração proposta para o Java HTTPS

| Variável | Valor ou origem |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `homologation` |
| `BACKSTABBER_STAGING_MODE` | `shared` |
| `BACKSTABBER_GAME_SCHEMA` | `bs_staging` |
| `BACKSTABBER_STAGING_PROJECT_REF` | Referência aprovada do projeto Backstabber existente |
| `SUPABASE_URL` | Origem HTTPS do mesmo projeto aprovado |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública do projeto |
| `DATABASE_URL` | Credencial exclusiva de `bs_staging_app` no endpoint aprovado |
| `SUPABASE_DB_CA_CERT` | CA PostgreSQL em PEM para `verify-full` |
| `BACKSTABBER_ALLOWED_ORIGIN` | Origem estável do Preview da branch Java |
| `PORT` ou `SERVER_PORT` | Porta fornecida pelo host |

O modo `dedicated` continua sendo o padrão de `homologation` e conserva a rejeição explícita ao projeto de produção. O novo modo `shared` exige schema de staging, papel restrito, mesma referência de projeto no Auth e no PostgreSQL e os endpoints admitidos. O host direto usa `bs_staging_app` na porta 5432. O pooler em modo sessão usa `bs_staging_app.<ref>` na porta 5432. O modo compartilhado recusa o usuário `postgres`, bancos alternativos, outro projeto e pooler de transação na porta 6543.

O Java exige TLS PostgreSQL com `verify-full` em homologação, inclusive quando outro perfil é ativado junto. O ensaio local usa explicitamente `dev` ou `test` e destinos de loopback. O Dockerfile existente usa Java 21, usuário 10001 e o perfil `homologation`.

## Inspeção da Vercel e proposta de Preview

A inspeção do conector foi somente de leitura. Foi confirmado o projeto `backstabber-homologacao`, identificador `prj_tsnn5U9YDJfrVprEblZujdJwAdz5`, framework Vite, e o Preview da branch Java no commit anterior `cc916e567096a4949b9b56148d0c41fe4b3fa77b`.

O alias estável verificado é [backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app](https://backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app).

O mesmo projeto Vercel também contém aliases da main, incluindo `backstabber.vercel.app` e `backstabber-homologacao.vercel.app`. A configuração futura precisa ser limitada a Preview e à branch Java.

As respostas do conector omitiram os campos remotos de build, install, diretório raiz e branch de Production. Os comandos `npm ci --prefix web`, `npm run build --prefix web` e a saída `web/dist` foram confirmados no `vercel.json` do repositório.

O inventário de variáveis, consultado sem descriptografia, mostrou entradas genéricas de Preview e Production para as variáveis públicas e de servidor, incluindo `DATABASE_URL`. Não havia `VITE_GAME_SCHEMA` nem entradas específicas da branch. Valores não foram consultados ou divulgados.

### Build e rewrite

O rewrite atual de `/api/v1/:path*` aponta para o Node em `/api/index?__route=:path*`. A proposta conserva essa configuração para os consumidores existentes e faz o React de staging usar uma `VITE_API_URL` absoluta para a API Java HTTPS.

Para a branch Java em Preview, o build exige `VITE_GAME_SCHEMA=bs_staging` e uma URL explícita HTTPS da API. O modo local admite HTTP somente em loopback. O build também deve recusar `DATABASE_URL` de servidor herdada pelo Preview Java, evitando que o endpoint Node legado mantenha acesso de escrita ao banco da produção.

Após aprovação, configure overrides exclusivos de **Preview + branch Java**. Os valores de Production ficam fora dessa alteração.

| Variável do Preview da branch | Proposta |
| --- | --- |
| `VITE_GAME_SCHEMA` | `bs_staging` |
| `VITE_API_URL` | `https://<host-java-aprovado>/api/v1` |
| `VITE_SUPABASE_URL` | Origem pública do projeto compartilhado aprovado |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública correspondente |
| `DATABASE_URL` | Override vazio para neutralizar a credencial herdada do Node nesse Preview |

O host Java ainda precisa ser escolhido e provisionado em etapa aprovada. A publicação desta branch pode disparar um build pela integração Git existente. A falta dessas variáveis interrompe o build de Preview antes da ativação da nova versão.

### CORS e OAuth

A origem CORS proposta é exatamente `https://backstabber-homologacao-git-feat-6522ba-luca-monteiros-projects.vercel.app`, com apenas esse host autorizado.

O callback Google continua no mesmo Auth do projeto compartilhado. O retorno ao React usa a origem estável da branch e os destinos `/?online=amigos` e `/?online=salas`, preservando o parâmetro de convite `sala`. A futura aprovação deve incluir a adição dos retornos necessários na allowlist do Supabase, com escopo restrito a essa origem e suporte às queries do convite. O Site URL e os retornos atuais devem ser preservados. O cliente Google existente é reutilizado.

As contas de teste devem ser autorizadas e já existentes no Auth. O login compartilha a infraestrutura e os registros de autenticação, enquanto cada conta cria seu perfil de jogo em staging. O aceite gerenciado deverá validar callback, PKCE, sessão, refresh, logout, convite e o host efetivo da API.

## Plano de hospedagem e custo

O caminho proposto é um ensaio futuro com Render Free Docker, uma instância, sem banco ou disco novos. O contexto de build é `backend/`, usando o Dockerfile existente. O serviço precisa escutar em `0.0.0.0` e na porta indicada pelo host, com HTTPS gerenciado. Configure `/actuator/health/readiness` como health check e mantenha `/actuator/health/liveness` para diagnóstico do processo.

O Render Free dispõe de 750 horas de instância compartilhadas por workspace por mês, adormece após 15 minutos sem tráfego e pode levar aproximadamente um minuto para reativar. O sistema de arquivos é efêmero. Disponibilidade da franquia, limites de build e tráfego precisam ser conferidos na conta antes da criação. [Render Free](https://render.com/docs/free), [Docker](https://render.com/docs/docker), [Web Services](https://render.com/docs/web-services), [Health checks](https://render.com/docs/health-checks)

Railway também suporta o Dockerfile e HTTPS com domínio gerado. O plano Free documenta uma franquia pequena de uso mensal e suspensão de serviços ao esgotá-la. Uma JVM e conexões persistentes podem consumir essa franquia rapidamente. O plano Hobby tem cobrança mensal e permanece fora da autorização desta sprint. O health check de implantação não substitui monitoramento contínuo. [Railway Free](https://docs.railway.com/pricing/free-plan), [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [HTTPS](https://docs.railway.com/networking/public-networking), [Health checks](https://docs.railway.com/deployments/healthchecks)

Não foi criado serviço, projeto, plano ou deploy nesses hosts. O pool JDBC mantém máximo de três conexões. Como a infraestrutura é compartilhada, carga, conexões, Auth e Realtime de staging consomem capacidade do mesmo projeto. O primeiro aceite deve usar uma única instância e carga pequena com contas de teste.

## Validação local

| Ensaio | Resultado |
| --- | --- |
| Suíte Java com PostgreSQL descartável | 105 casos, com 103 aprovados, zero falhas e dois cenários opcionais omitidos pela configuração padrão |
| Paridade Node/Java reativada separadamente | Os dois cenários opcionais passaram com `BACKSTABBER_NODE_PARITY=true` |
| Testes Java novos de schema e destino | Roteamento fechado, rejeição de identificadores arbitrários, proteção dedicada e validação compartilhada passaram |
| `SharedStagingDatabaseTest` | Sete testes passaram, incluindo HTTP, privacidade, permissões negativas, drift de grants, RLS, triggers, colisão, rollback e reaplicação |
| Frontend | 34 testes direcionados passaram em cinco arquivos |
| Verificações de build | Typecheck e lint passaram. Builds público padrão, staging local e simulação de Preview com API HTTPS passaram, com o aviso preexistente de bundle acima de 500 kB |
| Guards de Preview | Builds com schema incorreto, API relativa/insegura ou `DATABASE_URL` herdada foram recusados |
| Supabase local real | Migration aplicada com o administrador não-superusuário. Auth respondeu HTTP 200 e os dois schemas coexistiram |
| Duas APIs Java e três identidades sintéticas | Perfis separados, amizade, convite, lobby, início de partida, mãos privadas, recusa de terceiros e comando persistido somente em staging passaram |
| Realtime local real | Canais `hml:` e legados isolados, inscrições de terceiros recusadas, payloads limitados e presença observada por outro membro passaram |
| Preservação dos dados públicos | Os fingerprints das oito tabelas públicas permaneceram iguais após a remoção dos dados sintéticos do roteiro |
| Rollback no Supabase local real | Remoção e reaplicação passaram com o papel administrativo gerenciado, preservando fingerprints públicos, contagem do Auth e definições das políticas existentes |
| Administração dos novos papéis | As duas associações do criador foram verificadas como ADMIN-only, sem INHERIT ou SET |

A rodada final de presença recebeu ACK `ok` e confirmou o estado de conexão no segundo membro. As rodadas anteriores tiveram timeouts de ACK tanto no canal legado quanto no de staging. O roteiro foi ajustado para fechar canais após a recusa esperada de acesso e observar presença entre pares. A causa exata dos timeouts anteriores permanece sem diagnóstico conclusivo.

Os primeiros ensaios também identificaram incompatibilidades que foram corrigidas antes da validação final. A função local `realtime.send` é invoker, consultas textuais de privilégios exigiam acesso indevido ao Auth, e a criação de papéis por um administrador gerenciado precisava respeitar as opções de membership do PostgreSQL 17. O roteiro de limpeza passou a usar o papel restrito para staging e a garantir a limpeza mesmo após falhas de rede. As tentativas com falha foram revertidas transacionalmente ou tiveram somente os próprios dados sintéticos removidos.

Ao final, as duas APIs Java e a stack `backstabber-local` foram encerradas. As portas 18085, 18086 e 54321 deixaram de responder. A configuração Google local permaneceu desabilitada. A reaplicação local deixou o staging vazio e o login novamente com senha nula.

O teste Java `SharedStagingDatabaseTest` usa PostgreSQL descartável e Auth sintético em loopback. A migration e o rollback são exercitados com os dois schemas simultâneos. O roteiro `web/e2e/shared-staging.mjs` usa o Supabase local, duas instâncias Java, três identidades sintéticas locais e canais Realtime privados. Ele remove apenas os dados que criou e compara fingerprints das oito tabelas públicas ao final.

Para repetir a suíte Java com Docker e Java 21 disponíveis, a partir de `backend/`:

```powershell
$env:BACKSTABBER_TESTCONTAINERS = 'true'
$env:BACKSTABBER_NODE_PARITY = 'true'
.\mvnw.cmd test
```

Para repetir somente o ensaio com serviços Supabase reais, utilize a stack local `backstabber-local`, com Google desabilitado. A CLI pode restaurar um volume sem aplicar migrations novas. Nesse caso, confira o container e aplique a migration proposta exclusivamente naquele PostgreSQL local:

```powershell
Get-Content .\supabase\migrations\20261119000101_backstabber_shared_staging.sql -Raw |
  docker exec -i supabase_db_backstabber-local psql -X -U postgres -d postgres --set ON_ERROR_STOP=1
```

A migration recusa nomes já existentes. Se o staging local já tiver sido preparado, verifique sua estrutura antes de tentar reaplicar. Provisione uma senha local temporária para `bs_staging_app` por prompt seguro. Inicie dois JARs com `SPRING_PROFILES_ACTIVE=dev`, Auth exclusivamente em `127.0.0.1:54321` e PostgreSQL em `127.0.0.1:54322`. O JAR na porta 18085 usa `BACKSTABBER_GAME_SCHEMA=bs_staging` e a credencial restrita. O controle na porta 18086 usa `public` e a credencial administrativa exclusivamente local.

No terminal do teste, obtenha do status local a chave pública em `BACKSTABBER_LOCAL_SUPABASE_KEY` e a URI administrativa em `BACKSTABBER_LOCAL_DATABASE_URL`. Defina `BACKSTABBER_LOCAL_STAGING_DATABASE_URL` com a URI local do papel restrito. As duas URIs precisam ter host `127.0.0.1`, porta 54322, banco `postgres`, sem query string ou fragmento. Em `web/`, execute `node e2e/shared-staging.mjs`. Ao terminar, encerre os JARs, volte a senha local do papel a nula e pare somente essa stack local.

O browser utiliza o Java e o Realtime. O schema de staging pode permanecer fora da lista de schemas expostos pelo PostgREST. A auditoria futura deve conferir também funções `SECURITY DEFINER` acessíveis por concessões globais, pois funções customizadas existentes no ambiente hospedado não foram inspecionadas nesta sprint.

## Relatório de impacto

- Novos objetos de staging, novos papéis, políticas adicionais e concessões limitadas à ponte Realtime e à FK do Auth.
- Novas associações ADMIN-only do executor confiável sobre os dois papéis novos, para administração e rollback.
- Nenhuma cópia de dados de produção. Novos perfis e salas são criados somente no schema de staging.
- Contrato HTTP preservado. Seleção de schema e tópicos passa a ser configuração explícita de homologação.
- Build de Preview Java interrompido enquanto faltarem as configurações aprovadas ou houver credencial PostgreSQL do Node herdada.
- Capacidade e administração do projeto permanecem compartilhadas. A carga de homologação precisa ser limitada.

## Checklist de pré-aplicação para aprovação explícita

Estes itens descrevem uma etapa futura autorizada. Nenhum SQL foi executado no Supabase hospedado nesta sprint.

- [ ] Revisar o commit, a migration e o rollback propostos.
- [ ] Aprovar o projeto compartilhado, o schema `bs_staging`, os dois papéis e a delegação ADMIN-only do executor.
- [ ] Autorizar uma auditoria remota prévia de metadados, grants, ownership, memberships, funções e políticas, sem leitura ou cópia de dados de jogo.
- [ ] Confirmar ausência de colisões de nomes e de grants `PUBLIC` incompatíveis. Interromper se houver divergência, sem alterar privilégios de produção automaticamente.
- [ ] Conferir backup e o executor capaz de aplicar a migration e fazer o rollback restrito.
- [ ] Aprovar a aplicação transacional da migration e a senha exclusiva do papel, fornecida por canal local seguro.
- [ ] Verificar depois da aplicação o schema vazio, grants, RLS, triggers, tópicos `hml:`, papéis e ausência de mudanças nas políticas existentes.
- [ ] Aprovar o host Java e confirmar franquia gratuita, limites, TLS, CA, porta, readiness e tamanho do pool.
- [ ] Aprovar os overrides de Preview exclusivos da branch Java, incluindo a neutralização da credencial herdada do Node.
- [ ] Validar que `/api/v1` legado nesse Preview não consegue acessar o banco da produção, e que o React chama a origem Java HTTPS aprovada.
- [ ] Aprovar os retornos OAuth adicionais na origem estável, preservando Site URL, cliente Google e URLs atuais.
- [ ] Executar o aceite gerenciado com contas existentes autorizadas, testes negativos, privacidade e comparação dos estados por ambiente.
- [ ] Autorizar separadamente qualquer implantação, ampliação de custo ou aplicação do rollback.

O rollback proposto em `supabase/rollbacks/20261119000101_backstabber_shared_staging.rollback.sql` remove os objetos e dados de staging e suas políticas adicionais de Realtime, sem `CASCADE` sobre schemas externos. Dependências inesperadas fazem a operação falhar transacionalmente. O aceite da homologação compartilhada e qualquer cutover exigem decisões posteriores.
