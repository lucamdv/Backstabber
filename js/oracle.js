document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("oracle-modal");
  const grid = modal?.querySelector("[data-oracle-grid]");
  if (!modal || !grid) return;

  const personagens = [
    {
      nome: "Magnata",
      imagem: "images/magnata_card.png",
      acao: "Recebe 3 Créditos do tesouro ao declarar Taxa.",
      bloqueia: "Patrocínio — impede qualquer jogador de receber 2 Créditos.",
      bloqueadoPor: "Ninguém. A Taxa não pode ser bloqueada.",
    },
    {
      nome: "Executor",
      imagem: "images/executor_card.png",
      acao: "Paga 3 Créditos para eliminar uma influência de outro jogador.",
      bloqueia: "Nenhuma ação.",
      bloqueadoPor: "Sentinela.",
    },
    {
      nome: "Sentinela",
      imagem: "images/sentinela_card.png",
      acao: "Não possui ação própria no turno.",
      bloqueia: "Executor — protege sua influência da eliminação.",
      bloqueadoPor: "Não se aplica, pois não possui ação própria.",
    },
    {
      nome: "Mercenário",
      imagem: "images/mercenario_card.png",
      acao: "Rouba até 2 Créditos de outro jogador.",
      bloqueia: "Outro Mercenário.",
      bloqueadoPor: "Mercenário ou Broker.",
    },
    {
      nome: "Broker",
      imagem: "images/broker_card.png",
      acao: "Compra 2 cartas, escolhe quais influências manter e devolve 2 cartas ao baralho.",
      bloqueia: "Mercenário — impede que seus Créditos sejam roubados.",
      bloqueadoPor: "Ninguém. A negociação não pode ser bloqueada.",
    },
  ];

  personagens.forEach((personagem, index) => {
    const artigo = document.createElement("article");
    artigo.className = "oracle-card";
    artigo.style.setProperty("--oracle-index", String(index));

    const imagem = document.createElement("img");
    imagem.className = "oracle-card-image";
    imagem.src = personagem.imagem;
    imagem.alt = `Carta ${personagem.nome}`;
    imagem.loading = "lazy";

    const conteudo = document.createElement("div");
    conteudo.className = "oracle-card-content";

    const nome = document.createElement("h3");
    nome.textContent = personagem.nome;
    conteudo.appendChild(nome);

    const fatos = [
      ["AÇÃO", personagem.acao],
      ["BLOQUEIA", personagem.bloqueia],
      ["PODE SER BLOQUEADO POR", personagem.bloqueadoPor],
    ];

    fatos.forEach(([rotulo, texto]) => {
      const bloco = document.createElement("section");
      const titulo = document.createElement("h4");
      const descricao = document.createElement("p");
      titulo.textContent = rotulo;
      descricao.textContent = texto;
      bloco.append(titulo, descricao);
      conteudo.appendChild(bloco);
    });

    artigo.append(imagem, conteudo);
    grid.appendChild(artigo);
  });

  let gatilhoAtual = null;
  const botaoFechar = modal.querySelector("[data-oracle-close]");

  function abrirOraculo(event) {
    gatilhoAtual = event.currentTarget;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("oracle-open");
    modal.querySelector(".oracle-shell").scrollTop = 0;
    botaoFechar?.focus();
  }

  function fecharOraculo() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("oracle-open");
    gatilhoAtual?.focus();
  }

  document.querySelectorAll("[data-oracle-open]").forEach((botao) => {
    botao.addEventListener("click", abrirOraculo);
  });
  botaoFechar?.addEventListener("click", fecharOraculo);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) fecharOraculo();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) {
      event.stopImmediatePropagation();
      fecharOraculo();
    }
  });
});
