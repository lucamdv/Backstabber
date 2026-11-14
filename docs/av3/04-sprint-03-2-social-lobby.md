# Sprint 03.2 · Social e lobby

A API Java migra as operações sociais e de lobby de `web/server/social.ts`. O [contrato online implementado](../av2/backend-contract.md), o [inventário](01-backend-inventory.md) e a [matriz de paridade](03-migration-roadmap.md) identificam a referência de cada operação. Node.js continua servindo o frontend publicado.

## Rotas em `/api/v1`

| Módulo | Operações Java |
| --- | --- |
| Perfis e busca | `GET /profile`, `PUT /profile`, `POST /profile/heartbeat`, `GET /users?username=` |
| Amizades | `GET /friends`, `POST /friends/requests`, `POST /friends/requests/:id/respond`, `DELETE /friends/:userId` |
| Convites | `GET /invites`, `POST /invites/:id/respond`, `POST /rooms/:id/invite` |
| Lobby | `GET /rooms`, `POST /rooms`, `POST /rooms/join`, `GET /rooms/:id`, `POST /rooms/:id/heartbeat`, `POST /rooms/:id/ready`, `POST /rooms/:id/leave`, `POST /rooms/:id/close` |

Spring Security usa o UUID obtido no Supabase Auth como autor. A leitura de uma sala exige associação. Ações mutáveis verificam a associação antes do lock e voltam a verificá-la depois. Um terceiro recebe `404 ROOM_NOT_FOUND`. Respostas a convites e pedidos de amizade são restritas ao destinatário. Campos como `userId` em um pedido de amizade ou convite identificam o alvo.

## Implementação e transações

- `ProfileReader` cuida do perfil, do heartbeat social e da busca parametrizada. A constraint do PostgreSQL resolve a unicidade do nome. Avatar omitido limpa o valor. Preferência omitida preserva a opção anterior e cria o perfil com `false` por padrão.
- `FriendshipService` coordena consultas, pedidos e respostas com `FriendshipRepository`. As mutações de solicitação e resposta bloqueiam os dois perfis em ordem SQL de UUID com `FOR NO KEY UPDATE`. A atualização da solicitação exige `pending`, e a amizade guarda o par ordenado.
- `InvitationService` identifica o convite pelo destinatário, bloqueia a sala e atualiza somente um convite pendente e válido. O ingresso acontece na mesma transação. Uma rejeição de capacidade, perfil ou estado reverte também o consumo do convite e suas invalidações.
- `RoomService` aplica a política de lobby e `RoomRepository` consulta, bloqueia e modifica as linhas. Ingresso, heartbeat, prontidão, saída e fechamento obedecem ao lock da sala antes de tocar integrantes ou convites. Colisões de código usam `ON CONFLICT DO NOTHING` e até três sorteios criptográficos.
- A camada de serviço usa transações Spring JDBC. `TransactionLimits` aplica `SET LOCAL` à conexão corrente para lock (3 s), statement (8 s) e inatividade em transação (10 s). Um erro transitório volta como `503 SERVICE_UNAVAILABLE` após rollback. A resposta de sucesso só sai após o commit.

Os triggers da migração enviam invalidações privadas após as escritas. A suíte verifica o payload mínimo e a ausência de invalidação persistida após rollback. A entrega pelo Supabase Realtime gerenciado fica para a 03.5.

## Relógio, presença e ciclo de vida

| Condição | Regra aplicada |
| --- | --- |
| Heartbeat social | Uma gravação por janela de 10 s. |
| Presença social | Atividade nos últimos 45 s quando consentida. Campo `online: null` sem consentimento. |
| Presença em sala | Última atividade há menos de 35 s. Sala encerrada conserva a última atividade. |
| Convite | Válido por 15 min. Listagem exige lobby efetivamente aberto e convite pendente. |
| Lobby | Expira após 24 h. O snapshot deriva o estado fechado e a lista geral o exclui. |
| Abandono | Em partida iniciada, um membro pode fechar a sala quando o anfitrião está ausente há pelo menos 300 s. |

Os limites usam `now()` do PostgreSQL, inclusive após espera por locks, como no Node. Um novo integrante limpa a prontidão coletiva. Uma reentrada em lobby preserva prontidão e posição. Na saída do anfitrião, o sucessor é o membro mais antigo com desempate por UUID. Se a sala fica vazia, ela fecha e os convites pendentes expiram. Fechar conserva a partida associada e seu histórico.

## Paridade HTTP

Respostas preservam campos anuláveis e o envelope `{"error":"ERROR_CODE"}`. O corpo é lido em UTF-8 e limitado a 16.384 unidades UTF-16 após autenticação, segundo `createApi` do Node. O adaptador Node de desenvolvimento tem adicionalmente um limite próprio em bytes. A busca usa o primeiro parâmetro `username` e escapa o sublinhado como literal.

A comparação executável usa o handler Node de referência e a API Java com o mesmo PostgreSQL descartável. A suíte compara status, JSON e invalidações, normalizando somente IDs e códigos gerados e a data de expiração do convite depois de validar seu formato e janela. Testes nativos complementam com estados de banco e contenção observada em `pg_stat_activity`. O fluxo pode ser repetido com `BACKSTABBER_NODE_PARITY=true`, dependências Node instaladas em `web/` e um dos modos de PostgreSQL do [README](../../backend/README.md).

A validação de avatar usa `java.net.URI` para HTTPS com host explícito e sem credenciais. Entradas incomuns aceitas pela normalização WHATWG do Node, como hostname Unicode sem punycode, podem ser rejeitadas. Essa diferença não afeta os valores HTTPS convencionais usados pelo frontend.

## Resultados

- Maven `clean verify` executou 50 testes Java com PostgreSQL 17.11 isolado. A comparação direta conferiu 35 respostas HTTP e três grupos de invalidação idênticos.
- Seis corridas observaram dois backends distintos aguardando locks em `pg_stat_activity` antes de liberar a transação de controle. Elas cobrem pedidos e respostas de amizade, aceites duplicados, disputa de convites pela última vaga, aceite contra fechamento e ingresso direto pela última vaga.
- Typecheck, lint e build Vite passaram. A suíte React/Node padrão passou em 119 testes e a regressão Node com PostgreSQL nativo passou em oito.
- Playwright teve 48 aprovados, uma falha e um cenário com contas reais omitido. Os quatro casos que oscilaram na 03.1 passaram na execução integral da 03.2. Em 667×375, a checagem de presença detectou 4 px de diferença na altura do palco. As repetições isoladas não chegaram à asserção por timeout na navegação Vite. O carregamento e a medição de um layout previamente inalterado são causas prováveis a investigar na homologação visual.
- O Docker Engine estava indisponível. Os testes usaram a alternativa PostgreSQL nativo. Auth, OAuth e Realtime gerenciados ficam para homologação em ambiente autorizado.

## Fronteira do início

`RoomService.validateStart` exige transação ativa, valida associação, anfitrião, estado e `canStart` e conserva o lock de sala na transação do chamador. A rota HTTP `/start` permanece sem implementação. O motor da 03.3 e a persistência da 03.4 precisam compor uma única operação que crie a partida real, atualize a sala e expire convites, mantendo a ordem **sala → partida**. A Sprint 03.3 começa pelo domínio determinístico e pela paridade das janelas coletivas.
