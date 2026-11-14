# Sprint 03.3 · Motor autoritativo de partidas

O domínio Java reproduz `web/src/game/core/engine.ts` e `web/server/online-engine.ts`. A referência de protocolo é a seção [Sprint 02 — contrato implementado](../av2/backend-contract.md#sprint-02--contrato-implementado). O Node.js continua atendendo o frontend publicado. A Sprint 03.3 entrega o domínio e o formato de estado que serão integrados às rotas na [Sprint 03.4](03-migration-roadmap.md).

## Arquitetura e interfaces

| Componente em `com.backstabber.game` | Responsabilidade |
| --- | --- |
| `model.GameModel` | Records de cartas, jogadores, estado, janelas, votos, resultados e snapshots. Fases e comandos online são interfaces seladas com variantes explícitas. |
| `rules.CoreEngine` | `create(participants, random)` distribui cartas, `available(state)` lista ações e reações, `transition(state, command, expectedRevision, random)` valida e aplica a regra do turno. |
| `online.OnlineEngine` | `create(participants, random)` cria a rodada inicial, `transition(state, playerId, command, expectedRevision, random)` coordena o núcleo e as janelas, `project(state, viewerId, hostId, closed, hostAbandoned)` produz a visão individual. |
| `online.VoteWindows` | Abertura, elegibilidade, opções por jogador, prioridades, auditoria e adiamento do turno. |
| `projection.OnlineProjector` | Mapeia o estado interno para `OnlineView` com as decisões autorizadas e a mão da sessão. |
| `model.GameStateJson` | `read(serialized)` e `write(state)` convertem `OnlineState` para leitura e escrita do valor JSONB existente. |
| `random.GameRandom` | Abstração injetável de amostras em `[0, 1)`. `secure()` cria uma fonte criptográfica para uso futuro pela camada de aplicação. |

O motor é independente de HTTP, banco, Auth, Realtime e React. Cada chamada trabalha com o estado recebido. O núcleo monta um rascunho interno em suas transições e publica records com cópias das coleções. Votos e auditoria evoluem por substituição de valores. Uma rejeição contém um código de erro e preserva o estado anterior, inclusive histórico, cartas, turnos e votos.

## Estado e fases

`OnlineState` contém `game`, `round`, `window` e `audit`. Em `game` ficam `revision`, `activeId`, `players`, `deck`, `phase`, `continuation`, `offer`, `history`, `cemetery` e, quando existente, `lastEvent`. O histórico retém os cinco registros mais recentes, do mais novo para o mais antigo. O evento anterior é limpo quando o núcleo aplica uma nova transição. Um voto que só registra resposta conserva o evento corrente.

| `phase.kind` | Dados | Evolução |
| --- | --- | --- |
| `action` | Jogador ativo em `game.activeId`. | Ação direta, seleção de alvo ou declaração. |
| `target` | Ação dirigida. | O núcleo espera um adversário vivo. Uma ação online dirigida seleciona alvo na mesma chamada. |
| `reaction` | Declaração com autor e alvo, quando aplicável. | Votos coletivos resolvem aceitação, bloqueio ou contestação. |
| `block-reaction` | Declaração inicial e bloqueio. | Votos coletivos permitem aceitar ou contestar o bloqueio. |
| `loss` | Vítima, motivo `backstab`, `execution` ou `challenge` e resultado de contestação quando aplicável. | A vítima escolhe uma carta de sua mão após a ciência exigida na situação. |
| `negotiation` | Jogador autorizado e quantidade `keep`. | O Broker seleciona quais influências manter. A oferta permanece em `game.offer`. |
| `finished` | Vencedor e cartas finais no agregado. | A ciência pode permanecer aberta. Revanche só fica disponível ao anfitrião após a última resposta, com a sala aberta. |

## Elenco, cartas e aleatoriedade

O elenco online aceita de 2 a 10 participantes com IDs distintos. Preserva a ordem recebida do lobby. Cada jogador recebe dois créditos e duas influências, e o primeiro inicia em `action`, revisão 0, rodada 1. Os nomes são aparados, limitados a 18 unidades UTF-16 e comparados para duplicidade após normalização NFC e conversão para minúsculas em `pt-BR`.

O baralho contém 15 cartas para 2–6 participantes, 20 para 7–8, e 25 para 9–10. As cópias de `magnata`, `executor`, `sentinela`, `mercenario` e `broker` entram nessa ordem, com IDs `<personagem>-<índice>`. Fisher–Yates percorre os índices decrescentes e troca cada posição `i` por `floor(amostra × (i + 1))`. A distribuição, a substituição da carta comprovada e as compras do Broker retiram cartas do fim da lista. A perda devolve uma carta e embaralha. A negociação devolve e embaralha uma vez por sobra na ordem combinada da mão e da oferta.

`GameRandom.secure()` usa `SecureRandom` instanciado por chamada e divide um inteiro sem sinal de 32 bits por `2³²`, a mesma granularidade da fonte usada por `match-store.ts`. Nos testes, as amostras gravadas pelo Node são consumidas diretamente pelo Java. A comparação verifica o consumo exato na criação e em cada comando, além do estado resultante.

## Ações, contestações e perda

| Ação | Efeito e reação |
| --- | --- |
| `income` | Acrescenta um crédito e abre ciência antes de efetivar a troca do jogador ativo. |
| `patrocinio` | Acrescenta dois créditos se aceito. Adversário vivo pode bloquear declarando Magnata. |
| `tax` | Declara Magnata e acrescenta três créditos quando resolvida. Adversários vivos podem contestar. |
| `steal` | Declara Mercenário e transfere até dois créditos do alvo vivo, limitado pelo saldo. Só o alvo pode bloquear com Mercenário ou Broker. |
| `assassinate` | Declara Executor contra outro jogador vivo. Debita três créditos na declaração, inclusive se houver bloqueio ou contestação. Só o alvo pode bloquear com Sentinela. Se a ação for efetivada e o alvo continuar vivo, ele perde influência. |
| `backstab` | Custa sete créditos, exige alvo vivo e abre ciência seguida de perda. Independe de declaração de personagem. Com dez ou mais créditos e alvo válido, é a única ação disponível. |
| `negotiate` | Declara Broker. Após aceitação, compra duas cartas se a ação está disponível e exige exatamente `keep` IDs distintos da mão ou oferta. Mantém a ordem original das cartas escolhidas e abre ciência ao concluir. |

Declaração de personagem e bloqueio podem ser blefes. A contestação compara o personagem declarado com a mão, usa a primeira carta correspondente e retira a substituta do baralho antes de devolver a prova e embaralhar. Se a declaração for verdadeira, o contestador perde influência. Se for falsa, o declarante perde. A ação continua depois da perda quando a declaração de ação é comprovada ou o bloqueio é falso. Ação falsa e bloqueio comprovado cancelam a ação. A escolha de perda usa um ID da mão da vítima. A carta volta ao monte, o personagem entra no cemitério e a última influência gera `lastEvent` de eliminação. Vitória tem precedência sobre continuação pendente. A rotação ignora eliminados e efeitos de Executor ou Mercenário ignoram alvos já eliminados.

## Comandos e revisão

| `type` | Campos próprios | Validação de domínio |
| --- | --- | --- |
| `select-action` | `action`, `targetId` quando aplicável | Autor ativo e ação disponível. Extorsão, Executor e Backstab exigem adversário vivo. Ações sem alvo recusam `targetId`. |
| `vote` | `windowId`, `choice` | Janela atual, resposta ainda pendente e escolha nas opções do participante. |
| `lose` | `cardId` | Fase de perda, vítima correta e carta em sua mão. |
| `negotiate` | `keepIds` | Fase de negociação, autor correto, quantidade, unicidade e pertencimento ao conjunto autorizado. |

`playerId` chega como argumento separado do comando. A futura camada HTTP deve obtê-lo da identidade autenticada. A validação online verifica primeiro `STALE_REVISION`, depois se o autor está vivo (`NOT_AUTHORIZED`). Para um voto, verifica `INVALID_PHASE`, depois `ALREADY_RESPONDED`, depois a autorização da escolha. Comandos sem voto durante uma janela retornam `INVALID_PHASE`. Fora de janela, o núcleo verifica fase, autorização e conteúdo. Cada comando online aceito incrementa uma revisão, inclusive um ataque que executa seleção de ação e de alvo no núcleo. Revisões não substituem o registro idempotente de `commandId`, previsto na persistência da 03.4.

## Janelas coletivas

- `reaction` inclui os vivos exceto o autor da declaração. `block-reaction` inclui os vivos exceto o bloqueador. `acknowledge` inclui todos os vivos. O identificador tem a forma `<round>:<audit.length + 1>`.
- A janela espera uma resposta de cada elegível. Votos guardam `playerId`, `choice` e `sequence`, numerada pela ordem efetiva de resposta. Uma contestação vence qualquer bloqueio. Empates de tipo usam a primeira resposta registrada. A ausência de contestação e bloqueio resolve a aceitação; a auditoria conserva elegíveis, respostas e prioridade quando existente.
- `acknowledge` precede a escolha privada após contestação ou Backstab. Resoluções que completam o turno, perdas e conclusões de negociação também abrem ciência segundo `afterCore`. A aceitação direta de Executor com alvo vivo entra em `loss` e permite a escolha da vítima, sem uma ciência adicional entre aceitação e perda.
- Se o núcleo já avançou o turno, a ciência armazena o próximo jogador em `nextActiveId` e conserva o anterior em `game.activeId`. O último voto de ciência efetiva a mudança. O estado `finished` pode coexistir com essa janela, deixando `canRematch` desabilitado até o encerramento.

## Projeção autorizada

`OnlineProjector` exige um `viewerId` que pertença à partida. O snapshot expõe saldos e quantidades públicas por jogador, histórico, cemitério e o tamanho do baralho. `hand`, `revealed` e `privatePlayerId` representam a sessão consultada, inclusive fora do turno. `choices` contém as cartas da vítima ou a mão mais a oferta do Broker somente para o participante responsável, em sala aberta e sem janela coletiva. Para os demais, `choices` é vazio. `phase.cards` é vazio para todos os perdedores.

A janela pública inclui `id`, `kind`, `eligible`, `summary`, `responded` e as opções próprias. As listas superiores `blocks` e `challenges` são vazias no online. O snapshot exclui baralho, continuação, oferta interna, votos detalhados, prioridade e auditoria. Sala fechada suprime ações, alvos, escolhas privadas e opções da janela, preservando a própria mão. `canClose` exige sala aberta e anfitrião ou abandono do anfitrião. `canRematch` exige anfitrião, sala aberta, fase final e ausência de janela. Os indicadores `closed` e `hostAbandoned` vêm da camada chamadora.

No mesmo estado de negociação sem janela, a visão do Broker contém sua mão em `hand` e a mão mais as duas compras em `choices`. A visão de outro participante contém a própria mão em `hand` e `choices: []`. As fixtures de uma e duas influências comparam os dois JSONs contra o Node e verificam os IDs de cartas no payload completo.

## Compatibilidade do JSONB

`GameStateJson` usa o mesmo nível raiz `{game,round,window,audit}`. As fases mantêm o discriminador `kind`, e os comandos online tipados usam `type`. Campos escalares e listas conservam os nomes e a ordem dos elementos. `window` no estado interno, `continuation` e o `targetId` de uma declaração sem alvo são enviados como `null`. Campos opcionais ausentes como `lastEvent`, `challenge`, `block` da contestação, `priority`, `nextActiveId` e `window` na projeção são omitidos. A igualdade compara a árvore JSON. A ordem das chaves de objetos não tem significado para JSONB; a ordem de cartas, votos e histórico é parte da comparação.

Os testes usam estados do Node.js para ler, reserializar e avançar um comando em Java. O fluxo cobre criação, alvo interno, declaração, janela parcial, bloqueio, contestação, perda, oferta do Broker, ciência, vitória e auditoria acumulada. A codificação do agregado é destinada ao armazenamento; respostas ao cliente devem usar `OnlineView`.

## Paridade determinística

`backend/src/test/resources/game/generate-fixtures.mjs` importa os módulos de produção do Node. Grava `parity-scenarios.json` com versão de esquema, elenco, seed de teste, amostras, estado na criação, estado inicial do cenário, comandos, revisões, resultados e visões por sessão. O arquivo contém identidades e cartas fictícias para testes. O gerador valida a ausência de mutação no Node e guarda a quantidade de amostras de cada passo.

`DeterministicParityTest` compara a criação e cada resposta com a fixture, verifica o round-trip dos estados Node e recarrega o estado que o Java produziu para o próximo comando. Também compara snapshots de todos os participantes, ausência de mudança na entrada, uma revisão por sucesso, amostras consumidas e a superfície de IDs visíveis. Uma diferença aponta o comando e o caminho JSON correspondente. Com as dependências de `web/` instaladas, execute a geração ou a verificação nesse diretório.

```powershell
node --import tsx ../backend/src/test/resources/game/generate-fixtures.mjs
node --import tsx ../backend/src/test/resources/game/generate-fixtures.mjs --check
```

O roteiro `full-game-from-initial-deal-to-victory` inicia com Ada e Pessoa 2 com duas cartas e dois créditos. Três Taxas aceitas, intercaladas por Rendas do adversário e ciências coletivas, levam Ada a 11 créditos. Taxa é então rejeitada pela obrigatoriedade de Backstab. O primeiro Backstab custa sete e leva o adversário a uma carta após ciência e escolha. Uma nova Taxa volta a levar Ada aos sete créditos. O segundo Backstab elimina o adversário, rejeita seu voto tardio e abre a ciência final para a única sobrevivente. Cada um desses passos tem estado, janela, revisão e projeções confrontados contra a referência.

O roteiro compara 44 comandos e termina na revisão 42. No cenário `broker-keeps-2-private-influences`, no mesmo snapshot, Ada vê `broker-0` e `magnata-1` na própria mão e pode manter cartas entre essas duas e `sentinela-1` e `mercenario-1`. Pessoa 2 vê `mercenario-2` e `magnata-0` na própria mão, com `choices: []`.

Os outros roteiros da fixture cobrem as fronteiras de tamanho do baralho, prioridade entre votos, rejeições por fase/autor/revisão, custo antecipado do Executor, bloqueios verdadeiros e falsos, retorno de influência, Extorsão limitada ao saldo e Broker com uma ou duas influências. Os estados preparados para negociação com baralho insuficiente e para `target` do núcleo exercitam fronteiras defensivas além dos estados online alcançados pelo roteiro completo.

## Resultados e limitações

- A suíte do domínio passou em 28 testes, incluindo os 21 cenários do Node. Foram comparados 200 comandos (34 rejeições), 1.001 projeções e 462 amostras de RNG, na ordem original. A verificação do gerador com `--check` reproduziu a fixture versionada.
- A execução Maven `clean verify` passou em 78 testes, incluindo a foundation, Social/Lobby e a comparação HTTP Node–Java, com PostgreSQL 17.11 isolado.
- A árvore JSON coincidiu nos cenários executados. O codec de estado presume um `OnlineState` válido do backend Node.js. A validação estrutural do comando HTTP, incluindo `targetId: null` explícito, pertence ao parser de envelope da Sprint 03.4.
- Typecheck, lint e build Vite passaram. Foram aprovados 119 testes da suíte padrão React/Node e oito testes Node no PostgreSQL nativo.
- Playwright registrou 47 aprovados, duas falhas e um cenário omitido por depender de contas reais. Na execução integral, a gravação do Backstab piloto excedeu 45 s e o Backstab online mediu 2.172 ms frente a um limite de 2.300 ms. Os dois passaram na repetição isolada. O cenário de presença em 667×375, que falhou na 03.2, passou na execução integral desta sprint.

A suíte de domínio usa JUnit e fixtures locais. PostgreSQL, Docker, rede e Supabase são dispensáveis para essa comparação. Escrita e leitura transacionais no PostgreSQL, recuperação HTTP, presença de clientes reais e publicação do backend permanecem gates posteriores.

## Fronteira com a Sprint 03.4

A integração deve manter a ordem de lock **sala → partida**. `RoomService.validateStart()` conserva o lock da sala na transação chamadora. Nessa transação, a camada de partidas vai chamar `OnlineEngine.create`, persistir `GameStateJson.write`, marcar a sala `started` e expirar convites. Para comandos, a camada HTTP será responsável pelo envelope, `protocolVersion`, identidade e validação da sala. O serviço transacional deve ler o estado, consultar replay por `(match_id,user_id,command_id)`, chamar `OnlineEngine.transition` e persistir estado e resultado juntos. O snapshot HTTP deve provir de `OnlineEngine.project` após autorização. As três rotas de partida e a rota de início do lobby serão implementadas nessa integração.
