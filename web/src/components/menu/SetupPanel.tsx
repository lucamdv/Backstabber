import { useState } from 'react';
import type { FormEvent } from 'react';
import { deckSizeFor, validateNames } from '../../game/core/setup';
import { TerminalPanel } from './TerminalPanel';

type SetupPanelProps = {
  active: boolean;
  onStart: (names: string[]) => void;
  onResume?: () => void;
  onOnline?: () => void;
  onClose: () => void;
};

const playerCounts = Array.from({ length: 10 }, (_, index) => index + 1);

export function SetupPanel({ active, onStart, onResume, onOnline, onClose }: SetupPanelProps) {
  const [names, setNames] = useState(['', '']);
  const [error, setError] = useState<string | null>(null);
  const count = names.length;
  const deckSize = deckSizeFor(count);
  if (!active) return null;

  function changeCount(nextCount: number) {
    setNames((previous) => Array.from({ length: nextCount }, (_, index) => previous[index] ?? ''));
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = names.map((name) => name.trim());
    const validation = validateNames(trimmed);
    setError(validation);
    if (!validation) onStart(trimmed);
  }

  return (
    <TerminalPanel panel="jogar" title="NOVA PARTIDA" focusClose={false} onClose={onClose}>
      <p className="glitch-text">INICIALIZANDO PROTOCOLO DE CONEXÃO...</p>
      {onOnline && <button type="button" className="btn-start menu-resume" onClick={onOnline}>Jogar online</button>}
      {onResume && <button type="button" className="btn-start menu-resume" onClick={onResume}>Retomar partida</button>}
      <form id="setup-form" onSubmit={submit}>
        <div className="setup-options">
          <div className="input-group">
            <label htmlFor="player-count">&gt; NÚMERO DE JOGADORES</label>
            <select
              id="player-count"
              name="players"
              value={count}
              data-initial-focus
              onChange={(event) => changeCount(Number(event.target.value))}
            >
              {playerCounts.map((value) => (
                <option key={value} value={value}>{value === 1 ? '1 — SOLO / TESTE' : `${value} JOGADORES`}</option>
              ))}
            </select>
          </div>
          <div className="deck-preview" aria-live="polite">
            <span>BARALHO AUTOMÁTICO</span>
            <strong><output id="deck-size">{deckSize}</output> CARTAS</strong>
            <small id="deck-rule">{deckSize / 5} cópias de cada personagem</small>
          </div>
        </div>
        <div id="player-inputs" className="player-inputs">
          {names.map((name, index) => {
            const number = index + 1;
            return (
              <div key={number} className="input-group player-field">
                <label htmlFor={`player${number}`}>&gt; JOGADOR_{String(number).padStart(2, '0')}{index === 0 && ' [HOST]'}</label>
                <input
                  id={`player${number}`}
                  name={`p${number}`}
                  type="text"
                  required
                  maxLength={18}
                  autoComplete="off"
                  placeholder="Insira o ID"
                  value={name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNames((previous) => previous.map((current, position) => position === index ? value : current));
                    setError(null);
                  }}
                />
              </div>
            );
          })}
        </div>
        {error && <p className="menu-form-error" role="alert">{error}</p>}
        <button type="submit" className="btn-start">ESTABELECER CONEXÃO</button>
      </form>
    </TerminalPanel>
  );
}
