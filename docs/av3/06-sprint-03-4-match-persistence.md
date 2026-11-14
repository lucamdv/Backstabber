# AV3 · Sprint 03.4 — Persistência de partidas e comandos atômicos

## Contrato HTTP

As rotas usam o UUID validado pelo mesmo Supabase Auth das demais operações.

| Método e caminho | Resposta |
| --- | --- |
| POST /api/v1/rooms/{id}/start | Snapshot do lobby com status started e matchId real. Repetições autorizadas retornam a mesma partida. |
| GET /api/v1/matches/{id} | OnlineView para o membro autenticado, inclusive leitura histórica de sala fechada. |
| POST /api/v1/matches/{id}/commands | A confirmação {ok:true,revision} do comando aplicado ou recuperado do registro idempotente. |
| POST /api/v1/matches/{id}/rematch | OnlineView do anfitrião após avançar rodada e revisão no mesmo matchId. |

A rota de partida responde 404 tanto para UUID inválido quanto para um usuário sem acesso. Métodos incompatíveis em caminhos válidos de partida retornam 405. O início mantém os erros sociais, como HOST_REQUIRED, ROOM_NOT_READY e ROOM_NOT_OPEN. Na leitura, apenas o projetor do motor monta a resposta. A mão pertence ao usuário autenticado e as opções ficam vazias no fechamento. As janelas divulgam quem respondeu, sem a escolha alheia. O status do anfitrião usa seu heartbeat no banco e o mesmo limiar de 300 segundos do Node.

## Banco e transações

O serviço inicia a transação e usa TransactionLimits na conexão dos repositórios: lock_timeout de 3 s, statement_timeout de 8 s e idle_in_transaction_session_timeout de 10 s. O limite de instrução vale por consulta, como no Node. Escritas seguem sala → partida. A partida é consultada novamente com associação atualizada sob o lock da sala. A leitura usa uma única consulta autorizada para o JSONB e os metadados da sala, sem lock de escrita.

- **Início.** RoomService.validateStart verifica associação antes e depois do lock, anfitrião e prontidão. O elenco vem do snapshot ordenado por joined_at e UUID, com os usernames registrados. O motor cria a rodada 1 na revisão 0. A transação insere o estado, marca a sala como iniciada e expira seus convites pendentes.
- **Comandos.** O parser aplica o protocolo 1, IDs de 1 a 80 unidades UTF-16 e revisões no intervalo de inteiros seguros de JavaScript. Campos extras são descartados conforme o Node e playerId dentro de command é proibido. targetId ausente é omitido e null explícito é inválido. As escolhas de voto são normalizadas e keepIds conserva a ordem de entrada. A fingerprint reproduz o texto de JSON.stringify, incluindo ordem das propriedades e escapes. A chave de texto no PostgreSQL usa a mesma substituição UTF-8 do Node para surrogates isolados, enquanto a fingerprint mantém o escape JSON original.
- **Replay.** A chave é (match_id, user_id, command_id). A mesma fingerprint retorna o resultado armazenado antes de verificar fase e revisão. Outra fingerprint com a mesma chave resulta em 400 INVALID_COMMAND. A atualização de bs_matches e a inserção em bs_match_commands pertencem à mesma transação. Uma resposta perdida pode ser recuperada com o mesmo envelope.
- **Revanche.** O anfitrião precisa estar em sala iniciada e a vitória precisa estar confirmada sem janela pendente. O motor cria novo baralho, mãos e créditos iniciais para o elenco anterior. O serviço conserva o ID, a ordem dos jogadores, a auditoria e os registros idempotentes. A segunda requisição concorrente já encontra a nova fase.
- **Recuperação.** GameStateJson lê e grava o agregado completo em bs_matches.state. Janelas abertas, votos, escolhas do Broker, fases de perda e histórico são reconstruídos a cada requisição.
- **Invalidações.** As gravações usam as triggers canônicas. O teste local observa realtime.messages e confere evento invalidate privado com payload {"kind":"room"}. Um replay sem escrita não gera nova invalidação e rollback desfaz as linhas das triggers. A entrega WebSocket pelo Supabase gerenciado será verificada na 03.5.

O domínio continua determinando cartas e transições. Os erros de domínio seguem a precedência do Node. Falhas transitórias do PostgreSQL retornam 503. Quando a perda da conexão impede o rollback e o Spring encapsula a exceção, o tratamento consulta também o erro SQL original para preservar o 503. As respostas inesperadas usam 500 INTERNAL_ERROR sem detalhes do banco.

## Evidências reproduzíveis

Com o PostgreSQL local descrito no [README do backend](../../backend/README.md), habilite BACKSTABBER_NODE_PARITY=true e execute mvnw clean verify.

- **Paridade HTTP e JSONB.** NodeMatchParityTest usa o handler Node de referência e o servidor HTTP Spring real. Cada execução parte de fixtures descartáveis equivalentes. Os dois motores recebem amostras fixas de 0,5 somente na suíte. A comparação normaliza IDs gerados de sala e partida e o código de ingresso. Cobre partida completa, incluindo Broker, bloqueio, contestação, perda, Backstab, eliminação, vitória e revanche. Compara 103 respostas HTTP por roteiro, 36 fingerprints textuais, 38 estados JSONB e um grupo de invalidação. Os dois percursos mistos leem um snapshot e fazem replay do comando gravado pelo outro servidor, aplicam um novo voto e comparam o estado persistido e as projeções.
- **Concorrência.** MatchPersistenceTest registra espera de dois PIDs distintos via pg_stat_activity para início/início, saída/início, comando/replay, voto/voto, fechamento/comando, fechamento/revanche, revanche/revanche e revanche/comando. Uma leitura durante a espera do último voto observa o estado anterior. O teste confere auditoria com votos em sequência e resolução única.
- **Falhas e rollback.** A suíte força falha após inserir a partida e ao registrar a chave idempotente depois da atualização JSONB. Confere sala, convite, estado, revisão, chaves e invalidações em PostgreSQL. Exercita timeout de lock, deadlock e conexão encerrada durante o lock. Descarta a primeira confirmação para simular perda da resposta após commit e confere a revisão original e uma única gravação.
- **Reinício.** A suíte encerra um processo Spring Boot e inicia outro com PID diferente. O mesmo banco recupera sete checkpoints: voto parcial, contestação com voto pendente, oferta do Broker, ciência parcial, perda pendente, vitória aguardando ciência e pós-revanche. Dois snapshots autorizados e o JSONB são comparados antes de executar a próxima transição em cada partida.

## Resultados

- Maven clean verify inclui 92 testes Java, 21 cenários de paridade determinística e as duas comparações HTTP com Node. Foram usados JDK 21 e PostgreSQL 17.11 descartável em loopback. O Auth de teste usa identidades sintéticas.
- Web passou em typecheck, lint e build, com o aviso anterior sobre o tamanho do bundle. Vitest padrão passou em 119 testes. Os oito testes nativos do Node passaram em execução separada com PostgreSQL.
- Playwright com as gravações habilitadas teve 47 aprovados, dois reprovados e um omitido por depender de contas reais. O Backstab piloto excedeu 45 s e voltou a exceder esse limite na repetição isolada. O Backstab online mediu 1.611 ms frente ao mínimo de 2.300 ms e passou na repetição isolada. A presença em 1920×1080 mostrou um deslocamento vertical de 7 px na primeira rodada sem gravação e passou na suíte com gravação e na repetição isolada. A raiz das intermitências permanece em aberto. O frontend está fora do escopo da 03.4.
- As quatro rotas foram comparadas com o Node. Os casos exercitados não apresentaram divergências de corpo ou status. A perda da resposta foi simulada descartando a primeira confirmação no cliente, e a interrupção da conexão com PostgreSQL foi exercitada em um caso separado. O teste local reproduz as escritas das triggers no banco. OAuth real e a entrega gerenciada ficam para a homologação.

## Fronteira da Sprint 03.5

A homologação precisa exercitar o mesmo frontend com as duas APIs, contas reais, OAuth, CORS, TLS, pool de conexões, entrega Realtime e reconexão em ambiente autorizado. A API oficial em produção segue no Node.js.
