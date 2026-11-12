import type { Action, Character, GameView } from '../../game/application/contracts';

export const characterName: Record<Character, string> = {
  magnata: 'Magnata',
  executor: 'Executor',
  sentinela: 'Sentinela',
  mercenario: 'Mercenário',
  broker: 'Broker',
};

export const actions: Record<Action, {
  title: string;
  effect: string;
  note: string;
  mobile: string;
  character?: Character;
  targetTitle?: string;
}> = {
  income: { title: 'RENDA', effect: '+1 CRÉDITO', note: 'EXECUTA: AÇÃO LIVRE', mobile: 'AÇÃO LIVRE' },
  patrocinio: { title: 'PATROCÍNIO', effect: '+2 CRÉDITOS', note: 'AÇÃO LIVRE • BLOQ.: MAGNATA', mobile: 'LIVRE • BLOQ. MAG.' },
  tax: { title: 'TAXAR', effect: '+3 CRÉDITOS', note: 'EXECUTA: MAGNATA', mobile: 'MAGNATA', character: 'magnata' },
  steal: { title: 'EXTORQUIR', effect: 'ROUBA 2 CRÉDITOS', note: 'EXECUTA: MERCENÁRIO', mobile: 'MERCENÁRIO', character: 'mercenario', targetTitle: 'Extorquir (Mercenário)' },
  assassinate: { title: 'EXECUTAR', effect: 'CUSTO: 3 CRÉDITOS', note: 'EXECUTA: EXECUTOR', mobile: 'EXECUTOR', character: 'executor', targetTitle: 'Executar (3 Créditos)' },
  backstab: { title: 'BACKSTAB', effect: 'CUSTO: 7 CRÉDITOS', note: 'EXECUTA: AÇÃO LIVRE', mobile: 'AÇÃO LIVRE', targetTitle: 'Backstab (7 Créditos)' },
  negotiate: { title: 'NEGOCIAR', effect: 'COMPRA 2 CARTAS', note: 'EXECUTA: BROKER', mobile: 'BROKER', character: 'broker' },
};

export function playerName(view: GameView, id: string) {
  return view.players.find((player) => player.id === id)?.name ?? id;
}
