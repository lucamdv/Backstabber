// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import MenuPage from '../pages/MenuPage';

afterEach(cleanup);

function openSetup() {
  fireEvent.click(screen.getByRole('button', { name: 'Jogar' }));
  return within(screen.getByRole('dialog', { name: 'NOVA PARTIDA' }));
}

test('abre os painéis do menu e devolve o foco ao fechar por teclado', () => {
  render(<MenuPage onStart={() => undefined} />);
  const menu = within(screen.getByRole('navigation', { name: 'Menu principal' }));
  const friends = menu.getByRole('button', { name: 'Amigos' });
  friends.focus();
  fireEvent.click(friends);
  const dialog = screen.getByRole('dialog', { name: 'AMIGOS' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(friends);
  fireEvent.click(menu.getByRole('button', { name: 'Configurações' }));
  expect(screen.getByRole('dialog', { name: 'SISTEMA' })).toBeTruthy();
});

test('oferece de 2 a 10 jogadores e começa com dois campos na criação local', () => {
  render(<MenuPage onStart={() => undefined} />);
  const setup = openSetup();
  expect(setup.getByRole('combobox')).toHaveValue('2');
  expect(setup.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual([
    '2', '3', '4', '5', '6', '7', '8', '9', '10',
  ]);
  expect(setup.getAllByRole('textbox')).toHaveLength(2);
});

test('ignora uma mudança para solo enviada ao seletor de nova partida', () => {
  const onStart = vi.fn();
  render(<MenuPage onStart={onStart} />);
  const setup = openSetup();
  fireEvent.change(setup.getByRole('combobox'), { target: { value: '1' } });
  expect(setup.getByRole('combobox')).toHaveValue('2');
  expect(setup.getAllByRole('textbox')).toHaveLength(2);
  expect(onStart).not.toHaveBeenCalled();
});

test.each([[2, 15], [6, 15], [7, 20], [8, 20], [9, 25], [10, 25]])(
  'exibe %i campos e um baralho com %i cartas',
  (count, deck) => {
    render(<MenuPage onStart={() => undefined} />);
    const setup = openSetup();
    fireEvent.change(setup.getByRole('combobox'), { target: { value: String(count) } });
    expect(setup.getAllByRole('textbox')).toHaveLength(count);
    expect(setup.getByText(String(deck)).textContent).toBe(String(deck));
  },
);

test('rejeita nomes duplicados após remover espaços e ignorar maiúsculas', () => {
  const onStart = vi.fn();
  render(<MenuPage onStart={onStart} />);
  const setup = openSetup();
  const [first, second] = setup.getAllByRole('textbox');
  fireEvent.change(first, { target: { value: ' Eva ' } });
  fireEvent.change(second, { target: { value: 'EVA' } });
  fireEvent.click(setup.getByRole('button', { name: 'ESTABELECER CONEXÃO' }));
  expect(setup.getByRole('alert').textContent).toMatch(/diferent/i);
  expect(onStart).not.toHaveBeenCalled();
});

test('inicia a partida com os nomes em ordem e sem espaços nas pontas', () => {
  const onStart = vi.fn();
  render(<MenuPage onStart={onStart} />);
  const setup = openSetup();
  const [first, second] = setup.getAllByRole('textbox');
  fireEvent.change(first, { target: { value: ' Eva ' } });
  fireEvent.change(second, { target: { value: ' Rui ' } });
  fireEvent.click(setup.getByRole('button', { name: 'ESTABELECER CONEXÃO' }));
  expect(onStart).toHaveBeenCalledExactlyOnceWith(['Eva', 'Rui']);
});

test('oferece a recuperação de partida somente quando ela está disponível', () => {
  const onResume = vi.fn();
  const menu = render(<MenuPage onStart={() => undefined} />);
  const setup = openSetup();
  expect(setup.queryByRole('button', { name: 'Retomar partida' })).toBeNull();
  menu.rerender(<MenuPage onStart={() => undefined} onResume={onResume} />);
  fireEvent.click(setup.getByRole('button', { name: 'Retomar partida' }));
  expect(onResume).toHaveBeenCalledTimes(1);
});

test('mostra as cinco cartas do Oráculo e retorna ao menu quando fechado', () => {
  render(<MenuPage onStart={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir Oráculo' }));
  const oracle = within(screen.getByRole('dialog', { name: 'ORÁCULO' }));
  expect(oracle.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
    'Carta Magnata', 'Carta Executor', 'Carta Sentinela', 'Carta Mercenário', 'Carta Broker',
  ]);
  fireEvent.click(oracle.getByRole('button', { name: 'Fechar Oráculo' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
