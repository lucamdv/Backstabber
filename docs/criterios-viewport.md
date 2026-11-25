# Critérios de viewport do Backstabber

Os controles essenciais devem permanecer acessíveis na escala padrão, nas dimensões úteis da janela e dentro das áreas seguras do dispositivo. O documento fica sem rolagem horizontal. O zoom de acessibilidade do navegador permanece disponível. Validar a composição em janelas redimensionadas, mudanças de orientação, com teclado aberto e em modo standalone quando o PWA estiver disponível.

| Tela | Comportamento esperado |
| --- | --- |
| Menu principal, START, arena, vitória e derrota | Viewport fixa. Controles essenciais visíveis. |
| Configuração de partida | Viewport fixa. O conteúdo interno se adapta ao número de jogadores. |
| Login | Viewport fixa em condições normais. Área interna acessível quando o teclado ou a altura disponível exigirem. |
| Cadastro e recuperação | Rolagem interna quando necessária. Preservar a legibilidade dos campos, avisos e requisitos. |
| Amigos | Navegação fixa e rolagem interna. A lista tem prioridade na composição. |
| Salas | Viewport fixa e rolagem interna quando necessária. |
| Lobby | Prontidão e início em uma barra no fluxo do painel. A lista rola na região interna e a barra respeita a área segura. |
| Oráculo, regras e Configurações | Rolagem interna permitida. |

A regressão visual inclui 360×800, 390×844, 768×1024, 1366×768 e 1920×1080. Incluir lobby cheio, cadastro com altura reduzida e rotação para uma viewport baixa. Confirmar que cabeçalho, navegação e ações persistentes se mantêm acessíveis enquanto o conteúdo interno rola. Registrar o que foi emulado e o que foi visto em dispositivo ou app instalado.
