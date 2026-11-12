# Sprint 02.4 · Arena multiplayer

## Diagnóstico inicial

- A moldura do playmat estava embutida numa imagem aplicada ao `body` com `background-size: cover`. O recorte da imagem seguia a proporção da janela, enquanto o palco seguia as colunas e linhas do HUD.
- A arena online carregava o CSS móvel do piloto, que pressupõe retrato. Regras de altura mínima, margens negativas e recorte do HUD disputavam o espaço entre topbar, mão, palco e ações.
- O centro era uma área com rolagem interna. Um painel empilhava cartas, textos, progresso, botões e participantes, podendo exceder o espaço reservado pelo grid.
- A abertura online usava uma distribuição curta e o Backstab uma faixa de texto. O piloto tem uma sequência com cortinas, rupturas, ruído, choque, áudio e vibração.
- As declarações, verificações e consequências vêm de `phase`, `window` e `lastEvent`. O resultado de contestação pode colorir apenas a declaração verificada. A revisão pode mudar a cada voto, então a janela, a rodada e a partida identificam eventos de apresentação.

## Ordem da reconstrução

1. Enquadrar o HUD, prender a moldura ao palco e medir as dez resoluções.
2. Trocar o painel coletivo por cartas projetadas e comandos adjacentes. Exibir veracidade só depois da publicação pelo servidor.
3. Reaproveitar o Backstab local e criar a entrada com embaralhamento e túnel. Conferir duração, reconexão e movimento reduzido.
4. Exercitar estados privados, rodar regressões e verificar a publicação no alias estável.

## Implementação e verificação

- `arena-layout.css` define as linhas do HUD e o palco com o playmat dentro de sua própria moldura. No telefone em paisagem, a mão vai para a coluna lateral. O tribunal, o cemitério e o placar completo usam gavetas nas telas estreitas.
- `arena-hologram.css` distribui arte, comandos e progresso de votação. Declaração e bloqueio permanecem lado a lado. O contorno, o brilho e a interferência da verificação respeitam a arte e só aparecem na carta que o servidor verificou.
- `ArenaCinematic` é a sequência usada tanto pelo piloto quanto pelo multiplayer. A montagem online observa a janela pública de Backstab por rodada, ignora a janela histórica no primeiro snapshot e mantém a sequência durante atualizações de votos. O áudio online depende de interação anterior autorizada pelo navegador.
- `OnlineArenaIntro` reutiliza o embaralhamento do piloto e acrescenta o túnel e a revelação do HUD. A entrada é solicitada ao observar a transição do lobby, ou ao entrar em uma nova rodada de revanche. O relógio roda no cliente, com 5.000 ms em movimento normal e uma tela breve de preparação com movimento reduzido.
- Os testes de distribuição passaram a exercitar o bloqueio visual da entrada e a sincronização do snapshot durante seus cinco segundos. O teste de Backstab diferencia um evento novo de uma decisão de confirmação já aberta quando o jogador conecta.

Para reproduzir as evidências, a partir de `web`, instale o gravador com `npx playwright install ffmpeg`. Defina `BACKSTABBER_MOTION_OUTPUT` para os WebMs e `BACKSTABBER_VISUAL_OUTPUT` para as capturas. Execute `npm run test:e2e` com o Vite local. A gravação do Playwright captura a imagem e não inclui o áudio do navegador.
