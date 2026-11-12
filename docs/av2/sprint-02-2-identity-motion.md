# Backstabber · Sprint 02.2

Base `afbd4e8` de `feature/av2-sprint-02-homologation`. A apresentação online consome os snapshots e comandos existentes.

## Direção visual

- **Menu e login.** A arte de cidade de `images/menu.png` incorpora a marca em pixel-art. O formulário aparece num painel próprio, com entrada via Google e retorno ao menu local.
- **Perfil e contatos.** A moldura de avatar e as etiquetas de presença se repetem na identidade do jogador, nos contatos e na preparação da mesa. As confirmações acompanham as ações sociais.
- **Salas e lobby.** Código com contraste alto, ocupação, prontidão, estados de presença e instruções que explicam quando o anfitrião pode iniciar.
- **Arena.** A mesa reaproveita o playmat, o verso, as ilustrações e o tribunal do modo local. Rosa destaca disputa e ciano destaca recursos, progresso e informação pessoal. A compactação mantém os controles primários em destaque.
- **Decisões.** A declaração e a defesa usam as cartas e os tratamentos de acerto e blefe do modo local. A barra de progresso usa apenas os participantes e respostas que o servidor publica.
- **Resultado.** Vitória com brilho ciano e partículas breves. Derrota em rosa escuro, com linhas de interferência e identificação do vencedor. A tela usa as cartas finais só na perspectiva autorizada e respeita `canRematch` e `canClose`.

## Movimento

As entradas de painéis duram cerca de 240 ms. Créditos e influências ganham realce quando seus valores mudam. A preparação usa mudanças de prontidão e presença. Uma janela de decisão mantém a mesma chave durante respostas e revisões do snapshot. A abertura da mesa, o Backstab e o resultado usam sequências breves, com controles disponíveis durante a apresentação. O modo de movimento reduzido desativa partículas e reduz transições.

## Validação reproduzível

Na pasta `web`:

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
```

A suíte `e2e/identity.spec.ts` usa fixtures locais para login, lobby, contatos, perfil, arena, bloqueio, vitória e derrota. Ela cobre 1920×1080, 1366×768, 800×720, 768×1024, 390×844 e 360×800. Para exportar capturas de notebook e celular, defina `BACKSTABBER_VISUAL_OUTPUT` com o diretório de saída. A execução na base de homologação usa `BACKSTABBER_VISUAL_BASELINE=1` para capturar a apresentação original com os mesmos dados fictícios. A suíte também verifica foco no resultado e movimento reduzido.

Os testes de integração exercitam isolamento de mão, reconexão com voto pendente e revanche do anfitrião. O cenário com Google OAuth e Supabase Realtime reais depende das três sessões de teste descritas no [roteiro de homologação multiplayer](multiplayer-e2e.md).
