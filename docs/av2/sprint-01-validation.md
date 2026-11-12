# Sprint 01 — validação e paridade

Baseline oficial: `c1b1b29006e5546c5ee9e86dd8a04b327e01d93a`. Branch: `feature/av2-sprint-01-react-foundation`.

## Arquitetura

O React renderiza o menu, a arena, os diálogos e as animações. O motor em `web/src/game/core/` valida comandos e produz o próximo estado a partir da revisão atual. O adaptador local serializa esse estado e publica projeções. O tipo `GameAdapter` permite substituir a origem dos snapshots e comandos. O controlador do modo local também controla a passagem do aparelho.

## Paridade

| Funcionalidade | Situação | Evidência |
| --- | --- | --- |
| Menu, configuração, nomes e baralho automático | Preservada e testada | React Testing Library e início de partida no Chrome. |
| Arena, placar, créditos, influências e proteção da mão | Preservada e testada | Chrome mostrou zero cartas no DOM antes da liberação e durante a troca e duas após a liberação. |
| Renda, Patrocínio, Taxa, Executor, Mercenário, Broker e Backstab | Preservada e testada | Testes do motor e da arena. |
| Bloqueios, blefes, troca aleatória de prova e perdas | Preservada e testada | Testes de caracterização do legado, do motor e da arena. |
| Negociação | Preservada e testada | Escolha de duas entre quatro cartas no Chrome e retomada da oferta por testes. |
| Tribunal, cemitério, vitória, derrota e revanche | Preservada e testada | Partida de dois jogadores até a vitória no Chrome. Duas perdas registradas e revanche iniciada. |
| Oráculo, pausa e saída | Preservada e testada | Testes de interface e saída pelo menu no Chrome. |
| Recuperação local | Preservada e testada | Snapshots durante negociação e turno, recuperação de salvamento v3 estável e retomada pelo menu. |
| Salvamento v3 durante uma ação ambígua | Parcial | Detectado e preservado no legado. Negociação antiga pode omitir as cartas compradas. |
| Layout desktop e mobile, efeitos essenciais | Preservada e testada | Chrome desktop e retrato em 390 × 843 CSS px. As sete ações cabem no viewport sem rolagem. Menu original e React têm os mesmos retângulos dos quatro botões nesse tamanho. |
| Distribuição PWA e Electron | Pendente para a versão React | Canais do legado mantidos. Ver o plano de distribuição. |
| Backends Node.js e Spring Boot | Contrato documentado | Servidores, transporte remoto e autenticação ficam para sprints posteriores. |

A validação em navegador usou Chrome no Windows. iOS, Android físico, compatibilidade offline e Electron para a versão React permanecem sem homologação.

A instalação por lockfile, o lint, o TypeScript estrito e o build passaram. A suíte Vitest passou em 48 testes distribuídos entre caracterização do legado, motor, adaptador/persistência, menu e arena. O build gerou o JavaScript com aproximadamente 86 kB gzip, além dos recursos originais copiados sem recompressão.

## Reproduzir

Em `web/`, execute `npm ci`, `npm run test`, `npm run typecheck`, `npm run lint` e `npm run build`. Para a inspeção visual, use `npm run dev`, crie uma partida com dois jogadores e libere o primeiro terminal. Jogue Renda e confira a proteção da mão, negocie quatro cartas com o Broker e jogue até eliminar o adversário com Backstab. Use a vitória para iniciar a revanche e a pausa para sair e retomar a partida.
