document.addEventListener("DOMContentLoaded", () => {
  let jogo;
  let acaoAlvoPendente = null;
  let visualDeclaracoes = { acao: null, bloqueio: null };

  const storageKeys = {
    jogo: "backstabber_jogo_v3",
    log: "backstabber_log_v3",
    cemiterio: "backstabber_cemiterio_v3",
  };

  const ui = {
    scoreboard: document.getElementById("scoreboard"),
    playerHand: document.getElementById("player-hand"),
    playerName: document.getElementById("current-player-name"),
    actionLogBody: document.getElementById("action-log-body"),
    cemeteryList: document.getElementById("cemetery-list"),
    blindfold: document.getElementById("blindfold"),
    btnReveal: document.getElementById("btn-reveal"),
    blindfoldMsg: document.getElementById("blindfold-msg"),
    btnBackstab: document.getElementById("btn-backstab"),
    btnAssassinate: document.getElementById("btn-assassinate"),
    btnTax: document.getElementById("btn-tax"),
    btnIncome: document.getElementById("btn-income"),
    btnPatrocinio: document.getElementById("btn-patrocinio"),
    btnSteal: document.getElementById("btn-steal"),
    btnNegotiate: document.getElementById("btn-negotiate"),
    deckCount: document.getElementById("deck-count"),
    mobileDeckCount: document.getElementById("mobile-deck-count"),
    btnMobileTribunal: document.getElementById("btn-mobile-tribunal"),
    btnMobileCemetery: document.getElementById("btn-mobile-cemetery"),
    mobileTribunalPanel: document.getElementById("mobile-tribunal-panel"),
    mobileCemeteryPanel: document.getElementById("mobile-cemetery-panel"),
    mobileDrawerScrim: document.getElementById("mobile-drawer-scrim"),
    btnPause: document.getElementById("btn-pause"),
    pauseModal: document.getElementById("pause-modal"),
    btnResume: document.getElementById("btn-resume"),
    btnExitToMenu: document.getElementById("btn-exit-to-menu"),
    backstabCinematic: document.getElementById("backstab-cinematic"),
    backstabMessage: document.getElementById("backstab-impact-message"),
    defeatCinematic: document.getElementById("defeat-cinematic"),
    defeatPlayer: document.getElementById("defeat-player"),
    victoryModal: document.getElementById("victory-modal"),
    victoryPlayer: document.getElementById("victory-player"),
    victoryCards: document.getElementById("victory-cards"),
    victoryParticles: document.getElementById("victory-particles"),
    btnPlayAgain: document.getElementById("btn-play-again"),
    btnVictoryMenu: document.getElementById("btn-victory-menu"),
  };

  const uiReacoes = {
    modal: document.getElementById("reaction-modal"),
    titulo: document.getElementById("reaction-title"),
    desc: document.getElementById("reaction-desc"),
    actionsBox: document.getElementById("reaction-actions"),
    btnAccept: document.getElementById("btn-accept-action"),
    cardStage: document.getElementById("reaction-card-stage"),
  };
  
  const uiTarget = {
    modal: document.getElementById("target-modal"),
    titulo: document.getElementById("target-title"),
    actionsBox: document.getElementById("target-actions"),
    btnCancel: document.getElementById("btn-cancel-target"),
  };
  
  const uiPerda = {
    modal: document.getElementById("loss-modal"),
    titulo: document.getElementById("loss-title"),
    instruction: document.getElementById("loss-instruction"),
    btnReveal: document.getElementById("btn-reveal-loss-cards"),
    cardsBox: document.getElementById("loss-cards"),
  };
  
  const uiNegociacao = {
    modal: document.getElementById("negotiation-modal"),
    cardsBox: document.getElementById("negotiation-cards"),
    btnConfirm: document.getElementById("btn-confirm-negotiation"),
    instruction: document.getElementById("negotiation-instruction"),
  };

  function rolarModalParaTopo(modal) {
    const conteudo = modal.querySelector(".overlay-content");
    if (conteudo) conteudo.scrollTop = 0;
  }

  function exibirModal(modal) {
    modal.classList.add("active");
    rolarModalParaTopo(modal);
  }

  const paineisMoveis = [ui.mobileTribunalPanel, ui.mobileCemeteryPanel];
  const gatilhosMoveis = [ui.btnMobileTribunal, ui.btnMobileCemetery];

  function fecharPainelMovel(devolverFoco = false) {
    const gatilhoAtivo = gatilhosMoveis.find(
      (gatilho) => gatilho.getAttribute("aria-expanded") === "true",
    );
    paineisMoveis.forEach((painel) => painel.classList.remove("is-mobile-open"));
    gatilhosMoveis.forEach((gatilho) => gatilho.setAttribute("aria-expanded", "false"));
    ui.mobileDrawerScrim.classList.remove("is-open");
    document.body.classList.remove("mobile-drawer-open");
    if (devolverFoco) gatilhoAtivo?.focus();
  }

  function alternarPainelMovel(painel, gatilho) {
    const deveAbrir = !painel.classList.contains("is-mobile-open");
    fecharPainelMovel(false);
    if (!deveAbrir) return;
    painel.classList.add("is-mobile-open");
    gatilho.setAttribute("aria-expanded", "true");
    ui.mobileDrawerScrim.classList.add("is-open");
    document.body.classList.add("mobile-drawer-open");
    painel.querySelector("[data-mobile-panel-close]")?.focus();
  }

  function solicitarOrientacaoRetrato() {
    if (!window.matchMedia("(max-width: 900px), (pointer: coarse)").matches) return;
    const orientacao = window.screen?.orientation;
    if (typeof orientacao?.lock !== "function") return;
    orientacao.lock("portrait-primary").catch(() => undefined);
  }

  // Mapeia o nome do personagem do motor para a classe CSS da imagem
  function getClasseCarta(nomePersonagem) {
      const mapa = {
          "Magnata": "carta-magnata",
          "Mercenário": "carta-mercenario",
          "Executor": "carta-executor",
          "Sentinela": "carta-sentinela",
          "Broker": "carta-broker"
      };
      return mapa[nomePersonagem] || "carta-verso";
  }

  function getNomePersonagem(personagemId) {
    const nomes = {
      magnata: "Magnata",
      mercenario: "Mercenário",
      executor: "Executor",
      sentinela: "Sentinela",
      broker: "Broker",
    };
    return nomes[personagemId] || null;
  }

  function renderizarDeclaracoes() {
    uiReacoes.cardStage.innerHTML = "";
    const declaracoes = [
      ["acao", visualDeclaracoes.acao],
      ["bloqueio", visualDeclaracoes.bloqueio],
    ].filter(([, declaracao]) => declaracao);

    declaracoes.forEach(([slot, declaracao], index) => {
      if (index > 0) {
        const versus = document.createElement("span");
        versus.className = "declaration-versus";
        versus.textContent = "VS";
        uiReacoes.cardStage.appendChild(versus);
      }

      const wrapper = document.createElement("article");
      wrapper.className = "declared-card";
      wrapper.dataset.slot = slot;
      if (declaracao.resultado === true) wrapper.classList.add("is-truth");
      if (declaracao.resultado === false) wrapper.classList.add("is-lie");

      const carta = document.createElement("div");
      carta.className = `carta carta-declarada ${getClasseCarta(declaracao.personagem)}`;
      carta.setAttribute("role", "img");
      carta.setAttribute(
        "aria-label",
        declaracao.personagem || declaracao.titulo,
      );

      if (!declaracao.personagem) {
        const label = document.createElement("span");
        label.className = "generic-action-label";
        label.textContent = declaracao.titulo;
        carta.appendChild(label);
      }

      const jogador = document.createElement("strong");
      jogador.textContent = declaracao.jogador;
      const acao = document.createElement("span");
      acao.textContent = declaracao.titulo;
      wrapper.append(carta, jogador, acao);
      uiReacoes.cardStage.appendChild(wrapper);
    });
  }

  function prepararVisualAcao(personagem, titulo, jogador) {
    visualDeclaracoes = {
      acao: { personagem, titulo, jogador, resultado: null },
      bloqueio: null,
    };
    renderizarDeclaracoes();
  }

  function prepararVisualBloqueio(personagem, titulo, jogador) {
    visualDeclaracoes.bloqueio = {
      personagem,
      titulo,
      jogador,
      resultado: null,
    };
    renderizarDeclaracoes();
  }

  function marcarResultadoVisual(slot, verdadeiro) {
    if (visualDeclaracoes[slot]) {
      visualDeclaracoes[slot].resultado = verdadeiro;
      renderizarDeclaracoes();
    }
  }

  function abrirConfirmacaoVisual(titulo, descricao, aoContinuar) {
    uiReacoes.titulo.textContent = titulo;
    uiReacoes.desc.textContent = descricao;
    uiReacoes.actionsBox.innerHTML = "";
    uiReacoes.btnAccept.hidden = true;
    renderizarDeclaracoes();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-pass";
    btn.textContent = "Continuar";
    btn.onclick = () => {
      uiReacoes.modal.classList.remove("active");
      uiReacoes.btnAccept.hidden = false;
      aoContinuar();
    };
    uiReacoes.actionsBox.appendChild(btn);
    exibirModal(uiReacoes.modal);
  }

  // --- SISTEMA DE SALVAMENTO (LOCALSTORAGE) ---
  function salvarEstado() {
    const log = Array.from(ui.actionLogBody.querySelectorAll("tr")).map((tr) => ({
      nome: tr.cells[0]?.textContent || "",
      acao: tr.cells[1]?.textContent || "",
    }));
    const cemiterio = Array.from(ui.cemeteryList.children).map(
      (li) => li.dataset.personagem || li.textContent.trim(),
    );

    localStorage.setItem(storageKeys.jogo, JSON.stringify(jogo));
    localStorage.setItem(storageKeys.log, JSON.stringify(log));
    localStorage.setItem(storageKeys.cemiterio, JSON.stringify(cemiterio));
  }

  function atualizarTermosVisiveis(texto) {
    return String(texto)
      .replace(/^Pediu .+ \(\+2\)$/i, "Solicitou Patrocínio (+2 Créditos)")
      .replace(/\u0047\u006f\u006c\u0070\u0065\u0020\u0064\u0065\u0020\u0045\u0073\u0074\u0061\u0064\u006f/gi, "Backstab")
      .replace(/\b\u0047\u006f\u006c\u0070\u0065\b/gi, "Backstab")
      .replace(/\b\u0054\u0072\u006f\u0063\u0061\u0072\b/gi, "Negociar")
      .replace(/\b\u0074\u0072\u006f\u0063\u0061\b/gi, "negociação")
      .replace(/\bmoedas\b/gi, "Créditos")
      .replace(/\bmoeda\b/gi, "Crédito");
  }

  function carregarHistorico() {
    try {
      const log = JSON.parse(localStorage.getItem(storageKeys.log) || "[]");
      if (Array.isArray(log)) {
        log.forEach(({ nome, acao }) =>
          ui.actionLogBody.appendChild(
            criarLinhaAcao(nome, atualizarTermosVisiveis(acao)),
          ),
        );
      }

      const cemiterio = JSON.parse(
        localStorage.getItem(storageKeys.cemiterio) || "[]",
      );
      if (Array.isArray(cemiterio)) {
        cemiterio.forEach((registro) => {
          const personagem = String(registro)
            .replace(/^\u{1F480}\s*/u, "")
            .trim();
          if (personagem) ui.cemeteryList.appendChild(criarItemCemiterio(personagem));
        });
      }
    } catch (erro) {
      console.warn("O histórico antigo da partida foi ignorado.", erro);
    }
  }

  function carregarEstado() {
    const dadosSalvos = localStorage.getItem(storageKeys.jogo);
    if (!dadosSalvos) return false;

    let dados;
    try {
      dados = JSON.parse(dadosSalvos);
      if (!Array.isArray(dados.jogadores) || dados.jogadores.length < 1) {
        return false;
      }
    } catch (erro) {
      console.error("Não foi possível carregar a partida salva.", erro);
      return false;
    }

    jogo = new Jogo([], dados.baralho.totalCartas);
    jogo.turnoAtual = dados.turnoAtual;
    jogo.estadoAtual = "ESPERANDO_ACAO";
    jogo.acaoPendente = null;
    jogo.bloqueioPendente = null;
    jogo.jogadorSofrendoDano = null;

    jogo.baralho = new Baralho(dados.baralho.totalCartas);
    jogo.baralho.cartas = dados.baralho.cartas.map((c) =>
      Object.assign(new Carta(c.personagem), c)
    );

    jogo.jogadores = dados.jogadores.map((j) => {
      const nj = new Jogador(j.nome);
      nj.moedas = j.moedas;
      nj.cartas = j.cartas.map((c) => Object.assign(new Carta(c.personagem), c));
      return nj;
    });

    carregarHistorico();

    return true;
  }

  // --- LÓGICA DE INICIALIZAÇÃO ---
  const params = new URLSearchParams(window.location.search);
  const quantidadeSolicitada = Math.min(
    10,
    Math.max(1, Number(params.get("players")) || 10),
  );
  const nomes = Array.from({ length: quantidadeSolicitada }, (_, index) =>
    params.get(`p${index + 1}`)?.trim(),
  )
    .filter(Boolean);
  const totalCartas = nomes.length >= 9 ? 25 : nomes.length >= 7 ? 20 : 15;

  if (nomes.length >= 1) {
    jogo = new Jogo(nomes, totalCartas);
    salvarEstado();
    window.history.replaceState({}, document.title, "game.html");
  } else {
    const carregou = carregarEstado();
    if (!carregou) {
      alert("Nenhum jogo em andamento encontrado!");
      window.location.href = "index.html";
      return;
    }
  }

  function atualizarInterface() {
    const jogador = jogo.getJogadorAtual();

    ui.scoreboard.innerHTML = "";
    jogo.jogadores.forEach((j) => {
      const div = document.createElement("div");
      div.className = `player-stat ${j === jogador ? "active" : ""}`;
      if (j === jogador) div.setAttribute("aria-current", "true");
      const nome = document.createElement("strong");
      nome.textContent = j.nome;
      const recursos = document.createElement("span");
      recursos.className = "player-resources";
      recursos.textContent = `${j.moedas} CR · ${j.cartas.length} INF`;
      div.append(nome, recursos);
      ui.scoreboard.appendChild(div);
    });

    ui.playerName.textContent = jogador.nome;
    ui.playerHand.innerHTML = "";
    
    // ATUALIZADO: Puxa a classe da imagem ao invés de escrever texto
    jogador.cartas.forEach((carta) => {
      const div = document.createElement("div");
      div.className = `carta ${getClasseCarta(carta.personagem)}`;
      div.setAttribute("role", "img");
      div.setAttribute("aria-label", carta.personagem);
      div.title = carta.personagem;
      ui.playerHand.appendChild(div);
    });

    ui.playerHand.setAttribute(
      "aria-label",
      `Influências de ${jogador.nome}`,
    );
    ui.deckCount.textContent = `${jogo.baralho.cartas.length} RESTANTES`;
    ui.mobileDeckCount.textContent = String(jogo.baralho.cartas.length);

    const moedas = jogador.moedas;
    const temAlvo = jogo.jogadores.some((j) => j !== jogador && j.isVivo());
    const backstabObrigatorio = moedas >= 10 && temAlvo;
    ui.btnSteal.disabled = backstabObrigatorio || !temAlvo;
    ui.btnIncome.disabled = backstabObrigatorio;
    ui.btnPatrocinio.disabled = backstabObrigatorio;
    ui.btnTax.disabled = backstabObrigatorio;
    ui.btnAssassinate.disabled = moedas < 3 || backstabObrigatorio || !temAlvo;
    ui.btnNegotiate.disabled = backstabObrigatorio;
    ui.btnBackstab.disabled = moedas < 7 || !temAlvo;
  }

  function criarLinhaAcao(nome, acao) {
    const tr = document.createElement("tr");
    const tdNome = document.createElement("td");
    const tdAcao = document.createElement("td");
    tdNome.textContent = String(nome);
    tdAcao.textContent = String(acao);
    tr.append(tdNome, tdAcao);
    return tr;
  }

  function registrarAcao(nome, acao) {
    const tr = criarLinhaAcao(nome, acao);
    ui.actionLogBody.insertBefore(tr, ui.actionLogBody.firstChild);
    if (ui.actionLogBody.children.length > 5)
      ui.actionLogBody.removeChild(ui.actionLogBody.lastChild);
  }

  function criarItemCemiterio(personagem) {
    const li = document.createElement("li");
    li.dataset.personagem = personagem;

    const arte = document.createElement("div");
    arte.className = `carta cemetery-card-art ${getClasseCarta(personagem)}`;
    arte.setAttribute("role", "img");
    arte.setAttribute("aria-label", `Carta descartada: ${personagem}`);

    const nome = document.createElement("span");
    nome.className = "cemetery-card-name";
    nome.textContent = personagem;
    li.append(arte, nome);
    return li;
  }

  function registrarMorte(carta) {
    ui.cemeteryList.appendChild(criarItemCemiterio(carta.personagem));
  }

  function limparPartidaSalva() {
    Object.values(storageKeys).forEach((chave) => localStorage.removeItem(chave));
  }

  function tocarImpactoBackstab() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      const contexto = new AudioContextClass();
      const agora = contexto.currentTime;
      const ganho = contexto.createGain();
      ganho.gain.setValueAtTime(0.0001, agora);
      ganho.gain.exponentialRampToValueAtTime(0.34, agora + 0.025);
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + 0.72);
      ganho.connect(contexto.destination);

      const impacto = contexto.createOscillator();
      impacto.type = "sawtooth";
      impacto.frequency.setValueAtTime(92, agora);
      impacto.frequency.exponentialRampToValueAtTime(34, agora + 0.62);
      impacto.connect(ganho);
      impacto.start(agora);
      impacto.stop(agora + 0.72);

      const ruido = contexto.createBufferSource();
      const buffer = contexto.createBuffer(1, contexto.sampleRate * 0.22, contexto.sampleRate);
      const canal = buffer.getChannelData(0);
      for (let i = 0; i < canal.length; i += 1) {
        canal[i] = (Math.random() * 2 - 1) * (1 - i / canal.length);
      }
      const ganhoRuido = contexto.createGain();
      ganhoRuido.gain.setValueAtTime(0.18, agora + 0.1);
      ganhoRuido.gain.exponentialRampToValueAtTime(0.0001, agora + 0.34);
      ruido.buffer = buffer;
      ruido.connect(ganhoRuido);
      ganhoRuido.connect(contexto.destination);
      ruido.start(agora + 0.1);
      ruido.stop(agora + 0.35);

      window.setTimeout(() => contexto.close(), 900);
    } catch (erro) {
      console.debug("Impacto sonoro indisponível.", erro);
    }
  }

  function executarCinematicaBackstab(jogador, alvo, aoTerminar) {
    if (!ui.backstabCinematic) {
      aoTerminar();
      return;
    }

    const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ui.backstabMessage.textContent = `${jogador.nome} rompeu a defesa de ${alvo.nome}`;
    ui.backstabCinematic.classList.remove("active");
    void ui.backstabCinematic.offsetWidth;
    ui.backstabCinematic.classList.add("active");
    ui.backstabCinematic.setAttribute("aria-hidden", "false");
    document.body.classList.add("backstab-impact");
    tocarImpactoBackstab();
    navigator.vibrate?.([45, 35, 110]);

    window.setTimeout(() => {
      ui.backstabCinematic.classList.remove("active");
      ui.backstabCinematic.setAttribute("aria-hidden", "true");
      document.body.classList.remove("backstab-impact");
      aoTerminar();
    }, reduzirMovimento ? 350 : 2500);
  }

  function executarCinematicaDerrota(vitima, aoTerminar) {
    if (!ui.defeatCinematic) {
      aoTerminar();
      return;
    }

    const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ui.defeatPlayer.textContent = `${vitima.nome} perdeu todas as influências`;
    ui.defeatCinematic.classList.remove("active");
    void ui.defeatCinematic.offsetWidth;
    ui.defeatCinematic.classList.add("active");
    ui.defeatCinematic.setAttribute("aria-hidden", "false");

    window.setTimeout(() => {
      ui.defeatCinematic.classList.remove("active");
      ui.defeatCinematic.setAttribute("aria-hidden", "true");
      aoTerminar();
    }, reduzirMovimento ? 350 : 1750);
  }

  function mostrarVitoria(vencedor) {
    const nomesDaRevanche = jogo.jogadores.map((jogador) => jogador.nome);
    const totalCartas = jogo.baralho.totalCartas;

    ui.victoryPlayer.textContent = vencedor.nome;
    ui.victoryCards.innerHTML = "";
    if (ui.victoryParticles) {
      ui.victoryParticles.innerHTML = "";
      const cores = ["#00f3ff", "#ffffff", "#ff0055", "#5effff"];
      const totalParticulas = window.BackstabberPerformance?.particleCount ?? 28;
      for (let index = 0; index < totalParticulas; index += 1) {
        const particula = document.createElement("i");
        particula.className = "victory-particle";
        particula.style.setProperty("--particle-x", `${(index * 37) % 101}%`);
        particula.style.setProperty("--particle-size", `${3 + (index % 5)}px`);
        particula.style.setProperty("--particle-color", cores[index % cores.length]);
        particula.style.setProperty("--particle-speed", `${3.4 + (index % 7) * 0.38}s`);
        particula.style.setProperty("--particle-delay", `${(index % 9) * -0.37}s`);
        particula.style.setProperty("--particle-drift", `${-80 + (index % 11) * 16}px`);
        particula.style.setProperty("--particle-rotation", `${index * 19}deg`);
        ui.victoryParticles.appendChild(particula);
      }
    }
    vencedor.cartas.forEach((carta, index) => {
      const arte = document.createElement("div");
      arte.className = `carta victory-card ${getClasseCarta(carta.personagem)}`;
      arte.setAttribute("role", "img");
      arte.setAttribute("aria-label", carta.personagem);
      arte.style.animationDelay = `${index * 120}ms`;
      ui.victoryCards.appendChild(arte);
    });

    limparPartidaSalva();
    exibirModal(ui.victoryModal);

    ui.btnPlayAgain.onclick = () => {
      const paramsRevanche = new URLSearchParams();
      paramsRevanche.set("players", String(nomesDaRevanche.length));
      paramsRevanche.set("deck", String(totalCartas));
      nomesDaRevanche.forEach((nome, index) => {
        paramsRevanche.set(`p${index + 1}`, nome);
      });
      window.location.href = `game.html?${paramsRevanche.toString()}`;
    };

    ui.btnVictoryMenu.onclick = () => {
      window.location.href = "index.html";
    };

    window.requestAnimationFrame(() => ui.btnPlayAgain.focus());
  }

  function finalizarTurno() {
    const proximo = jogo.getJogadorAtual();
    ui.blindfoldMsg.textContent = `Passe o dispositivo para ${proximo.nome}`;
    ui.blindfold.classList.add("active");

    atualizarInterface();
    salvarEstado();
  }

  ui.btnReveal.addEventListener("click", () => {
    solicitarOrientacaoRetrato();
    ui.blindfold.classList.remove("active");
  });

  ui.btnMobileTribunal.addEventListener("click", () =>
    alternarPainelMovel(ui.mobileTribunalPanel, ui.btnMobileTribunal),
  );
  ui.btnMobileCemetery.addEventListener("click", () =>
    alternarPainelMovel(ui.mobileCemeteryPanel, ui.btnMobileCemetery),
  );
  ui.mobileDrawerScrim.addEventListener("click", () => fecharPainelMovel(true));
  document.querySelectorAll("[data-mobile-panel-close]").forEach((botao) => {
    botao.addEventListener("click", () => fecharPainelMovel(true));
  });

  window.addEventListener("backstabber-before-update", salvarEstado);

  ui.btnPause.addEventListener("click", () => {
    fecharPainelMovel(false);
    salvarEstado();
    document.body.classList.add("game-paused");
    exibirModal(ui.pauseModal);
    ui.btnResume.focus();
  });

  ui.btnResume.addEventListener("click", () => {
    ui.pauseModal.classList.remove("active");
    document.body.classList.remove("game-paused");
    ui.btnPause.focus();
  });

  ui.btnExitToMenu.addEventListener("click", () => {
    salvarEstado();
    window.location.href = "index.html";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("mobile-drawer-open")) {
      fecharPainelMovel(true);
      return;
    }
    if (event.key === "Escape" && ui.pauseModal.classList.contains("active")) {
      ui.pauseModal.classList.remove("active");
      document.body.classList.remove("game-paused");
      ui.btnPause.focus();
    }
  });

  // --- SISTEMA DE TRIBUNAL (CONTESTAÇÕES E BLOQUEIOS) ---
  function abrirPainelReacoes(acaoNome, isBloqueio = false) {
    const jogadorAtivo = isBloqueio ? jogo.bloqueioPendente.bloqueador : jogo.getJogadorAtual();
    const acaoOriginal = jogo.acaoPendente;
    const personagemBloqueio = isBloqueio
      ? getNomePersonagem(jogo.bloqueioPendente.personagem)
      : null;
    
    uiReacoes.titulo.textContent = isBloqueio ? "Contestar Defesa!" : "Momento de Reação!";
    uiReacoes.desc.textContent = isBloqueio 
        ? `${jogadorAtivo.nome} bloqueou com ${personagemBloqueio.toUpperCase()}. Alguém contesta o bloqueio?`
        : `${jogadorAtivo.nome} declarou: ${acaoNome.toUpperCase()}. O que vocês fazem?`;
    
    uiReacoes.actionsBox.innerHTML = "";
    uiReacoes.btnAccept.hidden = false;
    renderizarDeclaracoes();

    jogo.jogadores.forEach((j) => {
      if (j !== jogadorAtivo && j.isVivo()) {
        const alegaPersonagem = isBloqueio || [
          "magnata",
          "mercenario",
          "executor",
          "broker",
        ].includes(acaoOriginal?.acao);

        if (alegaPersonagem) {
          const btnContestar = document.createElement("button");
          btnContestar.textContent = `${j.nome} - Contestar!`;
          btnContestar.className = "btn-challenge";
          btnContestar.onclick = () => resolverContestacao(j, isBloqueio);
          uiReacoes.actionsBox.appendChild(btnContestar);
        }

        if (!isBloqueio) {
            if (acaoOriginal.acao === 'patrocinio') {
                criarBotaoBloqueio(j, 'magnata', 'Magnata');
            } else if (acaoOriginal.acao === 'executor' && acaoOriginal.alvo === j) {
                criarBotaoBloqueio(j, 'sentinela', 'Sentinela');
            } else if (acaoOriginal.acao === 'mercenario' && acaoOriginal.alvo === j) {
                criarBotaoBloqueio(j, 'mercenario', 'Mercenário');
                criarBotaoBloqueio(j, 'broker', 'Broker');
            }
        }
      }
    });
    exibirModal(uiReacoes.modal);
  }

  function criarBotaoBloqueio(jogador, personagemID, personagemNome) {
      const btnBlock = document.createElement("button");
      btnBlock.textContent = `${jogador.nome} - Bloquear (${personagemNome})`;
      btnBlock.className = "btn-block";
      btnBlock.onclick = () => {
          jogo.declararBloqueio(jogador, personagemID);
          prepararVisualBloqueio(personagemNome, "BLOQUEIO", jogador.nome);
          registrarAcao(jogador.nome, `BLOQUEOU a ação com ${personagemNome}!`);
          abrirPainelReacoes(`Bloqueio de ${personagemNome}`, true); 
      };
      uiReacoes.actionsBox.appendChild(btnBlock);
  }

  uiReacoes.btnAccept.addEventListener("click", () => {
    uiReacoes.modal.classList.remove("active");
    
    if (jogo.bloqueioPendente) {
        registrarAcao('SISTEMA', `Bloqueio aceito. Ação de ${jogo.getJogadorAtual().nome} foi cancelada.`);
        jogo.bloqueioPendente = null;
        jogo.acaoPendente = null; 
        jogo.passarTurno();
        finalizarTurno();
    } else {
        const jogadorAtivo = jogo.acaoPendente.jogadorAtivo;
        const resolveu = jogo.efetivarAcaoPendente();
        registrarAcao(jogadorAtivo.nome, `Ação efetuada sem oposição.`);
        
        if (resolveu === true) finalizarTurno();
        else if (resolveu === false) processarPerdaDeInfluencia();
        else if (resolveu === 'broker_negociacao') abrirPainelNegociacao();
    }
  });

  function resolverContestacao(contestador, isBloqueio) {
    let resultado;
    let jogadorContestado;

    if (isBloqueio) {
        jogadorContestado = jogo.bloqueioPendente.bloqueador;
        registrarAcao(contestador.nome, `CONTESTOU O BLOQUEIO de ${jogadorContestado.nome}!`);
        resultado = jogo.contestarBloqueio(contestador);
    } else {
        jogadorContestado = jogo.acaoPendente.jogadorAtivo;
        registrarAcao(contestador.nome, `CONTESTOU A AÇÃO de ${jogadorContestado.nome}!`);
        resultado = jogo.contestar(contestador);
    }

    const slot = isBloqueio ? "bloqueio" : "acao";
    marcarResultadoVisual(slot, resultado.verdadeiro);
    uiReacoes.titulo.textContent = resultado.verdadeiro
      ? "Carta confirmada!"
      : "Blefe descoberto!";
    uiReacoes.desc.textContent = resultado.verdadeiro
      ? `${jogadorContestado.nome} comprovou a carta. Ela voltou ao monte e uma nova carta aleatória foi comprada. ${contestador.nome} perde uma influência.`
      : `${jogadorContestado.nome} não tinha a carta declarada e perde uma influência.`;
    uiReacoes.actionsBox.innerHTML = "";
    uiReacoes.btnAccept.hidden = true;
    rolarModalParaTopo(uiReacoes.modal);

    const btnContinuar = document.createElement("button");
    btnContinuar.type = "button";
    btnContinuar.className = "btn-pass";
    btnContinuar.textContent = "Aplicar resultado";
    btnContinuar.onclick = () => {
      const finalizarContestacao = () => {
        uiReacoes.modal.classList.remove("active");
        uiReacoes.btnAccept.hidden = false;
        processarPerdaDeInfluencia();
      };

      if (!resultado.verdadeiro) {
        const cartaFalsa = uiReacoes.cardStage.querySelector(
          `[data-slot="${slot}"]`,
        );
        cartaFalsa?.classList.add("is-exiting");
        setTimeout(finalizarContestacao, 450);
      } else {
        finalizarContestacao();
      }
    };
    uiReacoes.actionsBox.appendChild(btnContinuar);
  }

  // --- SELEÇÃO DE ALVOS ---
  function abrirSelecaoDeAlvo(acaoNome, acaoId) {
    acaoAlvoPendente = acaoId;
    uiTarget.titulo.textContent = `Alvo para: ${acaoNome}`;
    uiTarget.actionsBox.innerHTML = "";
    const jogadorAtual = jogo.getJogadorAtual();

    jogo.jogadores.forEach((j) => {
      if (j !== jogadorAtual && j.isVivo()) {
        const btn = document.createElement("button");
        btn.textContent = `Alvo: ${j.nome}`;
        btn.className = "btn-challenge";
        btn.onclick = () => {
          uiTarget.modal.classList.remove("active");
          confirmarAcaoComAlvo(j);
        };
        uiTarget.actionsBox.appendChild(btn);
      }
    });
    exibirModal(uiTarget.modal);
  }

  uiTarget.btnCancel.addEventListener("click", () =>
    uiTarget.modal.classList.remove("active")
  );

  function confirmarAcaoComAlvo(alvo) {
    const jogador = jogo.getJogadorAtual();
    if (acaoAlvoPendente === "assassinar") {
      jogo.declararAcao("executor", alvo);
      prepararVisualAcao("Executor", "EXECUTAR", jogador.nome);
      registrarAcao(jogador.nome, `Tentou EXECUTAR ${alvo.nome}`);
      abrirPainelReacoes("Executor");
    } else if (acaoAlvoPendente === "backstab") {
      jogo.declararAcao("backstab", alvo);
      registrarAcao(jogador.nome, `BACKSTAB em ${alvo.nome}`);
      executarCinematicaBackstab(
        jogador,
        alvo,
        processarPerdaDeInfluencia,
      );
    } else if (acaoAlvoPendente === "mercenario") {
      jogo.declararAcao("mercenario", alvo);
      prepararVisualAcao("Mercenário", "EXTORQUIR", jogador.nome);
      registrarAcao(jogador.nome, `Tentou ROUBAR ${alvo.nome}`);
      abrirPainelReacoes("Mercenário");
    }
  }

  // --- PERDA DE INFLUÊNCIA ---
  function processarPerdaDeInfluencia() {
    const vitima = jogo.jogadorSofrendoDano;
    if (!vitima || !vitima.isVivo()) {
      console.warn("A perda de influência foi ignorada porque não há vítima válida.");
      return;
    }
    uiPerda.titulo.textContent = `${vitima.nome}, proteja sua mão`;
    uiPerda.instruction.textContent =
      `Passe o dispositivo para ${vitima.nome}. As cartas estão viradas para preservar suas influências.`;
    uiPerda.btnReveal.hidden = false;
    uiPerda.cardsBox.innerHTML = "";
    uiPerda.cardsBox.classList.add("is-concealed");

    const cartasOcultas = [];
    vitima.cartas.forEach((carta, index) => {
      const div = document.createElement("button");
      div.type = "button";
      div.className = "carta carta-escolha carta-verso";
      div.setAttribute("aria-label", "Influência virada para baixo");
      div.disabled = true;
      cartasOcultas.push({ elemento: div, carta, index });
      uiPerda.cardsBox.appendChild(div);
    });

    uiPerda.btnReveal.onclick = () => {
      uiPerda.btnReveal.hidden = true;
      uiPerda.cardsBox.classList.remove("is-concealed");
      uiPerda.instruction.textContent =
        "Agora escolha a influência que voltará ao monte.";

      cartasOcultas.forEach(({ elemento, carta, index }) => {
        elemento.classList.remove("carta-verso");
        elemento.classList.add(getClasseCarta(carta.personagem));
        elemento.disabled = false;
        elemento.setAttribute("aria-label", `Perder ${carta.personagem}`);
        elemento.addEventListener("click", () => confirmarMorte(vitima, index), {
          once: true,
        });
      });

      cartasOcultas[0]?.elemento.focus();
    };

    exibirModal(uiPerda.modal);
    window.requestAnimationFrame(() => uiPerda.btnReveal.focus());
  }

  function confirmarMorte(vitima, index) {
    uiPerda.modal.classList.remove("active");
    const morta = vitima.perderInfluencia(index);
    if (!morta) return;
    jogo.jogadorSofrendoDano = null;
    registrarAcao(vitima.nome, `Perdeu influência: ${morta.personagem}`);
    registrarMorte(morta);
    jogo.baralho.devolver(morta);

    const continuarPartida = () => {
      const vencedor = jogo.verificarVencedor();
      if (vencedor) {
        mostrarVitoria(vencedor);
        return;
      }

      if (jogo.acaoPendente) {
        const resolveu = jogo.efetivarAcaoPendente();
        
        if (resolveu === false) {
          processarPerdaDeInfluencia(); 
          return;
        } else if (resolveu === "broker_negociacao") {
          abrirPainelNegociacao();
          return;
        }
      } else {
        jogo.passarTurno();
      }

      jogo.estadoAtual = "ESPERANDO_ACAO";
      finalizarTurno();
    };

    if (!vitima.isVivo()) {
      registrarAcao("SISTEMA", `${vitima.nome} FOI ELIMINADO!`);
      executarCinematicaDerrota(vitima, continuarPartida);
      return;
    }

    continuarPartida();
  }

  // --- LÓGICA DO BROKER ---
  function abrirPainelNegociacao() {
    const jogador = jogo.getJogadorAtual();
    const quantidadeParaManter = jogador.cartas.length;
    const cartasCompradas = [jogo.baralho.comprar(), jogo.baralho.comprar()];
    const maoTemporaria = [...jogador.cartas, ...cartasCompradas];
    let selecionadasParaManter = [];

    uiNegociacao.cardsBox.innerHTML = "";
    uiNegociacao.btnConfirm.disabled = true;
    uiNegociacao.instruction.textContent =
      `Selecione ${quantidadeParaManter} carta(s) para MANTER. As demais voltarão ao monte.`;

    maoTemporaria.forEach((carta, index) => {
      const div = document.createElement("button");
      div.type = "button";
      div.className = `carta carta-escolha ${getClasseCarta(carta.personagem)}`;
      div.setAttribute("aria-label", `Manter ${carta.personagem}`);
      div.setAttribute("aria-pressed", "false");

      div.addEventListener("click", () => {
        if (selecionadasParaManter.includes(index)) {
          selecionadasParaManter = selecionadasParaManter.filter(
            (i) => i !== index,
          );
          div.classList.remove("selected");
          div.setAttribute("aria-pressed", "false");
        } else if (selecionadasParaManter.length < quantidadeParaManter) {
          selecionadasParaManter.push(index);
          div.classList.add("selected");
          div.setAttribute("aria-pressed", "true");
        }

        uiNegociacao.btnConfirm.disabled =
          selecionadasParaManter.length !== quantidadeParaManter;
      });

      uiNegociacao.cardsBox.appendChild(div);
    });

    exibirModal(uiNegociacao.modal);

    uiNegociacao.btnConfirm.onclick = () => {
      uiNegociacao.modal.classList.remove("active");
      const cartasFinais = [];

      maoTemporaria.forEach((carta, index) => {
        if (selecionadasParaManter.includes(index)) {
          cartasFinais.push(carta);
        } else {
          jogo.baralho.devolver(carta);
        }
      });

      jogador.cartas = cartasFinais;
      registrarAcao(jogador.nome, "Concluiu a negociação do Broker");
      jogo.acaoPendente = null;
      jogo.passarTurno();
      finalizarTurno();
    };
  }

  // --- ESCUTADORES PRINCIPAIS DE AÇÃO ---
  document.querySelectorAll(".btn-action").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = e.currentTarget.dataset.action;
      const jogador = jogo.getJogadorAtual();

      if (action === "income") {
        jogo.declararAcao("renda");
        prepararVisualAcao(null, "RENDA", jogador.nome);
        registrarAcao(jogador.nome, "Pegou Renda (+1)");
        abrirConfirmacaoVisual(
          "Renda recebida",
          `${jogador.nome} recebeu 1 Crédito sem oposição.`,
          finalizarTurno,
        );
      } else if (action === "patrocinio") {
        jogo.declararAcao("patrocinio");
        prepararVisualAcao(null, "PATROCÍNIO", jogador.nome);
        registrarAcao(jogador.nome, "Solicitou Patrocínio (+2 Créditos)");
        abrirPainelReacoes("Patrocínio (Bloqueável por Magnata)");
      } else if (action === "tax") {
        jogo.declararAcao("magnata");
        prepararVisualAcao("Magnata", "TAXAR", jogador.nome);
        registrarAcao(jogador.nome, "Declarou Magnata (+3)");
        abrirPainelReacoes("Magnata");
      } else if (action === "assassinate") {
        abrirSelecaoDeAlvo("Executar (3 Créditos)", "assassinar");
      } else if (action === "backstab") {
        abrirSelecaoDeAlvo("Backstab (7 Créditos)", "backstab");
      } else if (action === "steal") {
        abrirSelecaoDeAlvo("Extorquir (Mercenário)", "mercenario");
      } else if (action === "negotiate") { 
        jogo.declararAcao("broker");
        prepararVisualAcao("Broker", "NEGOCIAR", jogador.nome);
        registrarAcao(jogador.nome, "Declarou Broker (Negociar Cartas)");
        abrirPainelReacoes("Broker");
      }
    });
  });

  // --- INICIALIZAÇÃO CINEMATOGRÁFICA ---
  const introOverlay = document.getElementById("intro-overlay");
  
  if (introOverlay) {
      // Oculta a mesa do jogo e o blindfold enquanto a intro roda
      ui.blindfold.classList.remove("active");
      
      const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duracaoIntro = window.BackstabberPerformance?.introDuration ?? 3000;

      // Aguarda o embaralhamento, exceto quando o sistema pede menos movimento.
      setTimeout(() => {
          // Desvanece a tela de intro
          introOverlay.style.opacity = "0";
          introOverlay.style.visibility = "hidden";
          
          // Quando o desvanecimento acabar (0.5s), liga o jogo real
          setTimeout(() => {
              introOverlay.remove(); // Limpa do DOM
              atualizarInterface();
              ui.blindfoldMsg.textContent = `SISTEMA PRONTO! ${jogo.getJogadorAtual().nome}, assuma o terminal.`;
              ui.blindfold.classList.add("active");
          }, reduzirMovimento ? 0 : 500);
      }, reduzirMovimento ? 0 : duracaoIntro);
  } else {
      // Fallback de segurança se o HTML da intro não for encontrado
      atualizarInterface();
      ui.blindfoldMsg.textContent = `SISTEMA PRONTO! ${jogo.getJogadorAtual().nome}, assuma o terminal.`;
      ui.blindfold.classList.add("active");
  }

}); // Fim do DOMContentLoaded
