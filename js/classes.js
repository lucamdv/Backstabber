class Carta {
  constructor(personagem) {
    this.personagem = personagem;
    this.isRevelada = false;
  }
}

function normalizarPersonagem(nome) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

class Baralho {
  constructor(totalCartas = 15) {
    const tamanhosValidos = [15, 20, 25];
    this.totalCartas = tamanhosValidos.includes(totalCartas) ? totalCartas : 15;
    this.cartas = [];
    this.inicializar();
  }
  inicializar() {
    const personagens = [
      "Magnata",
      "Executor",
      "Mercenário",
      "Broker",
      "Sentinela",
    ];
    const copiasPorPersonagem = this.totalCartas / personagens.length;
    personagens.forEach((p) => {
      for (let i = 0; i < copiasPorPersonagem; i++) {
        this.cartas.push(new Carta(p));
      }
    });
    this.embaralhar();
  }
  embaralhar() {
    for (let i = this.cartas.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cartas[i], this.cartas[j]] = [this.cartas[j], this.cartas[i]];
    }
  }
  comprar() {
    return this.cartas.pop();
  }
  devolver(carta) {
    carta.isRevelada = false;
    this.cartas.push(carta);
    this.embaralhar();
  }
}

class Jogador {
  constructor(nome) {
    this.nome = nome;
    this.moedas = 2;
    this.cartas = [];
  }
  alterarMoedas(qtd) {
    this.moedas += qtd;
    if (this.moedas < 0) this.moedas = 0;
  }
  adicionarCarta(carta) {
    this.cartas.push(carta);
  }
  perderInfluencia(index) {
    const cartaMorta = this.cartas.splice(index, 1)[0];
    cartaMorta.isRevelada = true;
    return cartaMorta;
  }
  isVivo() {
    return this.cartas.length > 0;
  }
}

class Jogo {
  constructor(nomes, totalCartas = 15) {
    this.baralho = new Baralho(totalCartas);
    this.jogadores = nomes.map((n) => new Jogador(n));
    this.turnoAtual = 0;
    this.estadoAtual = "ESPERANDO_ACAO";
    this.acaoPendente = null;
    this.bloqueioPendente = null;
    this.jogadorSofrendoDano = null;
    this.distribuirCartas();
  }
  distribuirCartas() {
    this.jogadores.forEach((j) => {
      j.adicionarCarta(this.baralho.comprar());
      j.adicionarCarta(this.baralho.comprar());
    });
  }
  getJogadorAtual() {
    return this.jogadores[this.turnoAtual];
  }
  passarTurno() {
    let loop = 0;
    do {
      this.turnoAtual = (this.turnoAtual + 1) % this.jogadores.length;
      loop++;
      if (loop > this.jogadores.length) break;
    } while (!this.getJogadorAtual().isVivo());
  }
  verificarVencedor() {
    const vivos = this.jogadores.filter((j) => j.isVivo());
    return vivos.length === 1 ? vivos[0] : null;
  }
  declararAcao(acaoId, alvo = null) {
    this.bloqueioPendente = null;
    this.jogadorSofrendoDano = null;
    this.acaoPendente = {
      jogadorAtivo: this.getJogadorAtual(),
      acao: acaoId,
      alvo: alvo,
    };
    if (acaoId === "renda" || acaoId === "backstab") {
      this.resolverAcaoDireta();
    } else if (acaoId === "executor") {
      // O custo é pago ao declarar, mesmo que a ação seja bloqueada ou contestada.
      this.getJogadorAtual().alterarMoedas(-3);
    }
  }
  resolverAcaoDireta() {
    const { jogadorAtivo, acao, alvo } = this.acaoPendente;
    if (acao === "renda") {
      jogadorAtivo.alterarMoedas(1);
      this.acaoPendente = null; // Limpa a ação
      this.passarTurno(); // Renda passa o turno na hora
    } else if (acao === "backstab") {
      jogadorAtivo.alterarMoedas(-7);
      this.jogadorSofrendoDano = alvo;
      this.acaoPendente = null; // Limpa a ação para não aplicar Backstab duas vezes.
      // Não passa o turno aqui, pois o alvo ainda precisa escolher a carta para morrer
    }
  }

  efetivarAcaoPendente() {
    const { jogadorAtivo, acao, alvo } = this.acaoPendente;

    if (acao === "patrocinio") jogadorAtivo.alterarMoedas(2);
    else if (acao === "magnata") jogadorAtivo.alterarMoedas(3);
    else if (acao === "mercenario" && alvo.isVivo()) {
      const roubo = alvo.moedas >= 2 ? 2 : alvo.moedas; // Rouba 2 ou o que o cara tiver
      alvo.alterarMoedas(-roubo);
      jogadorAtivo.alterarMoedas(roubo);
    } else if (acao === "executor") {
      if (!alvo.isVivo()) {
        this.jogadorSofrendoDano = null;
        this.acaoPendente = null;
        this.passarTurno();
        return true;
      }
      this.jogadorSofrendoDano = alvo;
      this.acaoPendente = null;
      return false; // Retorna false pq espera o cara morrer
    } else if (acao === "broker") {
      // Não passa o turno: a interface ainda precisa concluir a negociação.
      return "broker_negociacao";
    }

    this.acaoPendente = null;
    this.passarTurno();
    return true;
  }

  contestar(contestador) {
    const { jogadorAtivo, acao } = this.acaoPendente;

    const cartaEncontrada = jogadorAtivo.cartas.find(
      (c) => normalizarPersonagem(c.personagem) === acao,
    );

    if (cartaEncontrada) {
      // O Jogador falou a verdade!
      jogadorAtivo.cartas = jogadorAtivo.cartas.filter(
        (c) => c !== cartaEncontrada,
      );
      const novaCarta = this.baralho.comprar();
      this.baralho.devolver(cartaEncontrada);
      jogadorAtivo.adicionarCarta(novaCarta);
      this.jogadorSofrendoDano = contestador;
      return { verdadeiro: true, personagem: cartaEncontrada.personagem };
    } else {
      // O Jogador mentiu!
      this.jogadorSofrendoDano = jogadorAtivo;
      this.acaoPendente = null;
      return { verdadeiro: false, personagem: acao };
    }
  }
  declararBloqueio(bloqueador, personagem) {
    this.bloqueioPendente = { bloqueador, personagem };
  }

  contestarBloqueio(contestador) {
    const { bloqueador, personagem } = this.bloqueioPendente;

    const cartaEncontrada = bloqueador.cartas.find(
      (c) => normalizarPersonagem(c.personagem) === personagem,
    );

    if (cartaEncontrada) {
      // O Bloqueador falou a verdade!
      bloqueador.cartas = bloqueador.cartas.filter(
        (c) => c !== cartaEncontrada,
      );
      const novaCarta = this.baralho.comprar();
      this.baralho.devolver(cartaEncontrada);
      bloqueador.adicionarCarta(novaCarta);

      this.jogadorSofrendoDano = contestador;
      this.acaoPendente = null; // A ação original foi bloqueada de vez!
      this.bloqueioPendente = null;
      return { verdadeiro: true, personagem: cartaEncontrada.personagem };
    } else {
      // O Bloqueador mentiu!
      this.jogadorSofrendoDano = bloqueador;
      this.bloqueioPendente = null; // Cancela o bloqueio fake
      return { verdadeiro: false, personagem };
    }
  }
  finalizarAcao() {
    this.acaoPendente = null;
    this.passarTurno();
  }
}
