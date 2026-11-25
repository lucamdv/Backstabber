// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FriendsPanel, SocialOverview } from '../online/FriendsPanel';
import type { Profile, Social } from '../online/types';

const person = (id: string, displayName: string): Profile => ({
  id, username: id, displayName, avatarUrl: null, showOnline: true,
});
const social: Social = {
  friends: [
    { ...person('ghost', 'Neon Ghost'), online: true },
    { ...person('silent', 'Operadora Oculta'), online: null },
    { ...person('zero', 'Setor Zero'), online: false },
  ],
  requests: [
    { id: 'incoming', status: 'pending', from: person('nova', 'Nova'), to: person('me', 'Eu') },
    { id: 'outgoing', status: 'pending', from: person('me', 'Eu'), to: person('relay', 'Relay') },
  ],
};

const callbacks = () => ({
  onSearch: vi.fn(async () => []), onRequest: vi.fn(), onRespond: vi.fn(), onRemove: vi.fn(),
});

afterEach(cleanup);

beforeEach(() => {
  // jsdom models the dialog element but does not implement opening its modal top layer.
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLDialogElement.prototype.close ??= function () { this.open = false; };
});

test('usa presença pública e convites pendentes nos contadores de Amigos', () => {
  const { rerender } = render(<SocialOverview invites={[]} />);
  expect(screen.queryByLabelText('Resumo de amigos')).toBeNull();
  rerender(<SocialOverview social={social} invites={[
    { id: 'open', status: 'pending', roomId: 'room', from: person('nova', 'Nova'), expiresAt: '2099-01-01' },
    { id: 'closed', status: 'accepted', roomId: 'room', from: person('nova', 'Nova'), expiresAt: '2099-01-01' },
  ]} />);
  const stats = screen.getByLabelText('Resumo de amigos');
  expect(stats).toHaveTextContent(/3\s*Contatos/);
  expect(stats).toHaveTextContent(/1\s*Amigo online/);
  expect(stats).toHaveTextContent(/1\s*Convite de sala/);
  rerender(<SocialOverview social={{ friends: [social.friends[1]], requests: [] }} invites={[]} />);
  expect(within(stats).getAllByRole('listitem')[0]).toHaveTextContent(/^1\s*Contato$/);
  expect(stats).toHaveTextContent(/0\s*Amigos online/);
  expect(stats).toHaveTextContent(/0\s*Convites de sala/);
});

test('filtra por nome, usuário e presença sem rotular presença oculta', () => {
  render(<FriendsPanel userId="me" social={social} busy={false} {...callbacks()} />);
  const friends = within(screen.getByRole('list', { name: 'Lista de amigos' }));
  const hidden = friends.getByText('Operadora Oculta').closest('li')!;
  expect(within(hidden).queryByText(/^(Online|Offline)$/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Online' }));
  expect(friends.getByText('Neon Ghost')).toBeVisible();
  expect(friends.queryByText('Operadora Oculta')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar amigos' }), { target: { value: '@silent' } });
  expect(friends.getByText('Operadora Oculta')).toBeVisible();
  expect(friends.queryByText('Neon Ghost')).toBeNull();
  expect(screen.getByRole('list', { name: 'Solicitações recebidas' })).toHaveTextContent('Nova');
  expect(screen.getByRole('list', { name: 'Solicitações enviadas' })).toHaveTextContent('Relay');
});

test('exige confirmação e devolve o foco quando a remoção é cancelada', () => {
  const actions = callbacks();
  render(<FriendsPanel userId="me" social={social} busy={false} {...actions} />);
  const remove = screen.getByRole('button', { name: 'Remover Neon Ghost' });
  remove.focus();
  fireEvent.click(remove);
  const dialog = screen.getByRole('dialog', { name: 'Remover contato?' });
  expect(actions.onRemove).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(remove).toHaveFocus();
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
  expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith('ghost');
  expect(screen.getByRole('searchbox', { name: 'Buscar amigos' })).toHaveFocus();
});

test('fecha a confirmação se o snapshot remover o contato e não reabre quando ele volta', () => {
  const actions = callbacks();
  const view = render(<FriendsPanel userId="me" social={social} busy={false} {...actions} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remover Neon Ghost' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  view.rerender(<FriendsPanel userId="me" social={{ ...social, friends: social.friends.slice(1) }} busy={false} {...actions} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Buscar amigos' })).toHaveFocus();
  view.rerender(<FriendsPanel userId="me" social={social} busy={false} {...actions} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(actions.onRemove).not.toHaveBeenCalled();
});
