# Backstabber AV2 · Inventário da Sprint 01

A referência é a [main oficial no commit c1b1b29](https://github.com/lucamdv/Backstabber/tree/c1b1b29006e5546c5ee9e86dd8a04b327e01d93a). O clone de trabalho iniciou limpo nesse commit. A revisão abaixo descreve a aplicação estática original, incluindo suas limitações.

## Arquivos e dependências

| Arquivo | Responsabilidade e acoplamentos |
| --- | --- |
| `index.html` | Entrada do menu, vídeo responsivo, marca, Jogar, Amigos, Configurações, Oráculo e instalação PWA. Carrega os estilos do menu, o perfil de execução e os scripts de configuração, Oráculo e PWA. |
| `game.html` | Entrada da arena, placar, mão, ações, tribunal, cemitério, modais e estrutura das cinemáticas. Carrega os estilos da arena e o Oráculo. `classes.js` deve ser executado antes de `engine.js`. |
| `js/classes.js` | Classes globais `Carta`, `Baralho`, `Jogador` e `Jogo`. Gerencia distribuição, recursos, cartas, turnos, ações pendentes e contestação. Usa `Math.random` diretamente. Origem, fase e elegibilidade da maioria das jogadas dependem da interface. |
| `js/engine.js` | Orquestra `Jogo`, interpreta parâmetros da URL, inicializa e salva a partida, monta placar, mão, registro e cemitério. Abre reações, seleciona alvos, aplica dano, negocia e executa cinemáticas. Depende do HTML, de `localStorage`, dos perfis de desempenho e do evento de atualização do PWA. |
| `js/setup.js` | Abre painéis do menu, calcula tamanho do baralho, recria campos e rejeita duplicatas sem distinção de caixa. Envia a configuração em parâmetros para `game.html`. |
| `js/oracle.js` | Define arte e regras textuais dos cinco personagens. Gera os cartões do Oráculo em ambas as páginas e controla abertura, foco, fechamento por Escape e clique no fundo. O texto é separado das regras executáveis. |
| `js/pwa.js` | Registra o service worker no navegador, verifica `version.json`, posterga a recarga durante a arena e oferece instalação nativa ou instruções de iOS/Android. Dispara `backstabber-before-update` antes de recarregar. |
| `js/runtime-performance.js` | Escolhe perfil reduzido, leve, equilibrado ou completo conforme preferências, hardware e Electron. Configura classes/atributos CSS, pausa o vídeo em segundo plano e tenta conter zoom quando instalado. |
| `css/style-index.css`, `css/mobile-index.css` | Estilos do menu, vídeo de fundo, formulários, painéis, marca e atalhos mobile. A folha mobile usa consultas de tamanho e ponteiro. |
| `css/style-game.css`, `css/mobile-game.css` | Estilos da arena, cartas, placar, modais, cinemáticas, opções de movimento reduzido e modos de desempenho. A folha mobile controla a composição em retrato e as gavetas de registro e descarte. |
| `css/oracle.css` | Layout, imagens, animação e responsividade do Oráculo compartilhado. |
| `images/`, `background.mp4`, `background_mobile.mp4` | Logo, isotipo, cinco cartas, verso, tabuleiros, arte do menu e ícones de instalação. Os vídeos são selecionados por tamanho/orientação/ponteiro e devem conservar o arquivo da plataforma correspondente. O commit de referência troca apenas o vídeo mobile. |
| `manifest.webmanifest`, `sw.js`, `version.json` | Identidade e comportamento de instalação, cache do shell e marcador de versão usado para atualização. O cache estático atual não inclui os vídeos. |
| `desktop/main.cjs`, `desktop/prepare-*-icon.cjs` | Abre o HTML local em Electron com sandbox, isolamento de contexto e Node desativado no renderer. Gerencia tela cheia, ícones e atualização pelo GitHub. |
| `package.json`, `scripts/prepare-web-release.cjs`, `.github/workflows/` | Scripts e configuração do Electron Builder, montagem da cópia estática `web-dist`, publicação no GitHub Pages e geração de instaladores de Windows e macOS. |

## Regras observadas

- Partida local com 1 a 10 nomes. A distribuição entrega 2 créditos e 2 influências a cada jogador. Para 1–6, 7–8 e 9–10 jogadores, respectivamente, o baralho tem 15, 20 e 25 cartas, com cópias iguais de cada personagem. O embaralhamento usa Fisher–Yates. Solo é um modo de teste que continua mesmo com uma única pessoa e não permite ações com alvo.
- Renda recebe 1 crédito, avança o turno imediatamente no domínio e mostra uma confirmação na UI. Patrocínio recebe 2 após a janela de bloqueio. Taxar recebe 3. Patrocínio não declara personagem e não pode ser contestado.
- Extorquir, Executar e Backstab exigem outro jogador vivo como alvo. Extorquir transfere até 2 créditos e não resolve contra um alvo já eliminado. Executar cobra 3 na declaração, inclusive se a ação for cancelada. Backstab cobra 7, não abre reação e aguarda a escolha de perda da vítima antes de avançar. Com pelo menos 10 créditos e alvo válido, só Backstab fica disponível.
- Magnata pode ser alegado por qualquer outro jogador vivo para bloquear Patrocínio. Só o alvo pode declarar Sentinela contra Executor ou Mercenário/Broker contra Extorquir. Um bloqueio pode ser blefe e, se aceito, cancela a ação. Taxa e negociação não têm bloqueio.
- Qualquer outro jogador vivo pode contestar uma declaração de Magnata, Mercenário, Executor ou Broker. Para contestar bloqueio, a mesma regra é aplicada tomando o bloqueador como declarante. O autor da ação original pode contestar o bloqueador.
- Em declaração verdadeira, o legado compra a próxima carta do baralho embaralhado **antes** de devolver e reembaralhar a carta de prova. O contestador perde uma influência e a ação pendente é executada diretamente. Uma ação comprovada por contestação não abre nova janela de bloqueio. Em declaração falsa, o declarante perde influência e a ação é cancelada.
- Se um bloqueio contestado for verdadeiro, a carta de prova é substituída, o contestador perde influência e a ação é cancelada. Se for falso, o bloqueador perde influência e a ação original é executada diretamente. Executor e Extorquir não atingem um alvo que já saiu da partida na perda anterior.
- A negociação do Broker compra 2 cartas, mostra as opções junto às atuais e exige selecionar exatamente a quantidade anterior de influências, inclusive quando resta apenas uma. As 2 restantes voltam ao baralho e o turno avança.
- Uma influência perdida é mostrada no cemitério e devolvida fisicamente ao baralho, que é reembaralhado. Cemitério é registro público, não uma segunda pilha de cartas. A vítima revela a mão por ação explícita antes de escolher. Se uma perda deixa um único sobrevivente, a vitória precede qualquer execução pendente. O turno ignora eliminados. A revanche usa o mesmo elenco em um novo embaralhamento.

## Estados e renderização

O legado inicializa `estadoAtual` como `ESPERANDO_ACAO`. Na prática, o fluxo depende da combinação de `acaoPendente`, `bloqueioPendente`, `jogadorSofrendoDano`, modal ativo, timers e closures. Seleção de alvo e opções temporárias do Broker vivem no controlador da interface. Em uma migração, ação, reação, reação ao bloqueio, perda, negociação, passagem de turno e fim da partida devem ser distinguíveis por dados estruturados. Alvo em edição, seleção ainda não confirmada, gavetas, pausa, revelação local e animações podem ser estados de interface.

A configuração usa `innerHTML` e `createElement` para recriar campos. O motor original escreve `textContent`, classes, atributos e botões em placar, mão, alvos, reações, negociações e fim da partida. Os painéis, as animações e o Oráculo combinam classes CSS, timers, eventos e foco imperativo. No React, a estrutura da tela deve ser consequência de estado e propriedades. Foco, orientação, vídeo, áudio e visibilidade de documento continuam sendo integrações com APIs da plataforma.

## Salvamento e riscos

| Chave | Conteúdo |
| --- | --- |
| `backstabber_jogo_v3` | JSON com `baralho: {totalCartas, cartas}`, `jogadores: [{nome, moedas, cartas}]`, `turnoAtual`, `estadoAtual`, `acaoPendente`, `bloqueioPendente` e `jogadorSofrendoDano`. Cada carta tem `personagem` e `isRevelada`. |
| `backstabber_log_v3` | Lista de `{nome, acao}` extraída da tabela DOM, mais recente primeiro, com limite de cinco nas inserções. |
| `backstabber_cemiterio_v3` | Lista cronológica de nomes de personagens extraída do cemitério. O leitor antigo também aceita prefixo de caveira. |

O legado salva no início, no fim do turno, ao pausar/sair e antes de atualização do PWA. Ao restaurar, descarta as pendências e recria a arena no estado de esperar ação. Um salvamento intermediário pode incluir custo já pago ou cartas temporárias omitidas do Broker. A importação deve validar o formato e conservar os dados originais quando não for possível reconstruir um turno com segurança. O histórico e o cemitério não devem servir de autoridade para calcular cartas ou créditos.

Riscos para verificação: perda de duas influências na mesma sequência após contestação verdadeira do Executor, bloqueador falso já eliminado antes da execução, redução de créditos do alvo, custo cobrado uma única vez, descarte do estado pendente na vitória, rejeição de jogadores eliminados e conservação do baralho. A arena legada monta a mão ativa sob a sobreposição de passagem e reação. A versão React precisa retirar os rostos do DOM nesses momentos, mantendo a revelação privada no turno e na perda. Entradas legadas de nomes apenas com espaços podem passar pelo formulário e ser descartadas ao interpretar a URL, mudando a quantidade de participantes. Validação deve acontecer antes da criação da partida. CSS de menu e arena usa seletores globais nas páginas separadas, exigindo escopo ou carregamento por rota no SPA. O fallback de rotação, tamanhos mobile, foco, tela cheia e movimento reduzido precisam de validação no navegador.

Os testes de caracterização em `web/src/tests/legacy.test.ts` executam o JavaScript original com aleatoriedade determinística. Cobrem a cobrança antecipada do Executor, a compra da substituta antes da devolução da prova, a continuação após um bloqueio falso e os rostos montados sob a tela de passagem. Este último teste registra o problema do legado para orientar um teste de privacidade com expectativa inversa na arena React.
