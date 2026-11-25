# Skills de design do Backstabber

Use estas skills do Codex nas mudanças de interface. A identidade cyberpunk, as artes e o comportamento das telas aprovadas orientam a revisão.

| Skill | Uso no projeto |
| --- | --- |
| `frontend-design` | Avaliar a composição, o contraste, a leitura e a hierarquia da ação principal usando os elementos visuais do jogo. |
| `ui-ux-pro-max` | Consultar padrões de interação e acessibilidade antes de ajustar busca, formulários, foco, áreas de toque ou painéis que rolam. |
| Superpowers | Usar `systematic-debugging` para reproduzir regressões, `test-driven-development` para alterações de comportamento e `verification-before-completion` para confirmar os resultados. |

Instale as skills de design pelo instalador de skills do Codex. Aponte para os diretórios das fontes oficiais e leia os respectivos `SKILL.md`. As revisões usadas no candidato foram `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` para Frontend Design e `8db36338810d0942567b97ce439affd1619fcf31` para UI/UX Pro Max. Os arquivos das skills ficam na instalação local do Codex. [Frontend Design da Anthropic](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design) · [UI/UX Pro Max da NextLevelBuilder](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/8db36338810d0942567b97ce439affd1619fcf31/.claude/skills/ui-ux-pro-max)

Para uma dúvida pontual, execute o `scripts/search.py` da instalação de `ui-ux-pro-max` com a consulta e o domínio pertinente, como `"sticky footer focus safe area" --domain ux`. Compare o resultado com a interface atual e os critérios do jogo. Verifique em navegador os tamanhos solicitados, o foco, a navegação e a área útil com teclado. Registre quais cenários usaram dados controlados e quais usaram a integração real. [Critérios de viewport](criterios-viewport.md)
