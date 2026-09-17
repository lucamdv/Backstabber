document.addEventListener('DOMContentLoaded', () => {
    
    const menuButtons = document.querySelectorAll('.menu-btn[data-target]');
    const panels = document.querySelectorAll('.terminal-modal');
    const closeButtons = document.querySelectorAll('.close-btn');
    let ultimoBotaoAtivo = null;

    function fecharPaineis(devolverFoco = true) {
        panels.forEach(panel => {
            panel.classList.remove('active-panel');
            panel.setAttribute('aria-hidden', 'true');
        });
        menuButtons.forEach(button => {
            button.classList.remove('active');
            button.setAttribute('aria-expanded', 'false');
        });

        if (devolverFoco && ultimoBotaoAtivo) ultimoBotaoAtivo.focus();
    }

    // Lógica de abrir painel ao clicar no menu
    menuButtons.forEach(button => {
        button.addEventListener('click', () => {
            fecharPaineis(false);
            ultimoBotaoAtivo = button;

            // Deixa o botão clicado rosa
            button.classList.add('active');
            button.setAttribute('aria-expanded', 'true');
            
            // Abre o painel correspondente
            const targetId = button.getAttribute('data-target');
            const painel = document.getElementById(targetId);
            painel.classList.add('active-panel');
            painel.setAttribute('aria-hidden', 'false');
            (
                painel.querySelector('select') ||
                painel.querySelector('input') ||
                painel.querySelector('button')
            )?.focus();
        });
    });

    // Lógica de fechar o painel ao clicar no "X"
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            fecharPaineis();
        });
    });

    document.addEventListener('keydown', (event) => {
        if (document.getElementById('oracle-modal')?.classList.contains('is-open')) return;
        if (event.key === 'Escape') fecharPaineis();
    });

    const form = document.getElementById('setup-form');
    const playerCount = document.getElementById('player-count');
    const playerInputs = document.getElementById('player-inputs');
    const deckSize = document.getElementById('deck-size');
    const deckRule = document.getElementById('deck-rule');

    function obterConfiguracaoBaralho(quantidadeJogadores) {
        if (quantidadeJogadores >= 9) return { total: 25, copias: 5 };
        if (quantidadeJogadores >= 7) return { total: 20, copias: 4 };
        return { total: 15, copias: 3 };
    }

    function renderizarJogadores() {
        const quantidade = Number(playerCount.value);
        const nomesAtuais = Array.from(
            playerInputs.querySelectorAll('[data-player-input]'),
            input => input.value,
        );
        const config = obterConfiguracaoBaralho(quantidade);

        deckSize.value = config.total;
        deckRule.textContent = `${config.copias} cópias de cada personagem`;
        playerInputs.innerHTML = '';

        for (let index = 0; index < quantidade; index++) {
            const numero = index + 1;
            const group = document.createElement('div');
            const label = document.createElement('label');
            const input = document.createElement('input');

            group.className = 'input-group player-field';
            label.htmlFor = `player${numero}`;
            label.textContent = `> JOGADOR_${String(numero).padStart(2, '0')}${index === 0 ? ' [HOST]' : ''}`;

            input.type = 'text';
            input.id = `player${numero}`;
            input.name = `p${numero}`;
            input.required = true;
            input.maxLength = 18;
            input.autocomplete = 'off';
            input.placeholder = 'Insira o ID';
            input.dataset.playerInput = 'true';
            input.value = nomesAtuais[index] || '';

            group.append(label, input);
            playerInputs.appendChild(group);
        }
    }

    playerCount.addEventListener('change', renderizarJogadores);
    renderizarJogadores();

    // Lógica de Iniciar a Partida
    form.addEventListener('submit', function(event) {
        event.preventDefault();
        
        const params = new URLSearchParams();
        const inputs = Array.from(playerInputs.querySelectorAll('[data-player-input]'));
        const quantidade = inputs.length;
        const config = obterConfiguracaoBaralho(quantidade);
        const nomes = inputs.map(input => input.value.trim());
        const nomesNormalizados = nomes.map(nome => nome.toLocaleLowerCase('pt-BR'));

        if (new Set(nomesNormalizados).size !== nomesNormalizados.length) {
            alert('Use um nome diferente para cada jogador.');
            return;
        }

        params.set('players', String(quantidade));
        params.set('deck', String(config.total));
        nomes.forEach((nome, index) => {
            params.set(`p${index + 1}`, nome);
        });
        
        window.location.href = `game.html?${params.toString()}`;
    });
});
