export function deckSizeFor(count: number): 15 | 20 | 25 {
  return count <= 6 ? 15 : count <= 8 ? 20 : 25;
}

export function validateNames(names: readonly string[]): string | null {
  if (names.length < 1 || names.length > 10) return 'Escolha entre 1 e 10 jogadores.';
  if (names.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 18)) {
    return 'Preencha os nomes dos jogadores (até 18 caracteres).';
  }
  const normalized = names.map(name => name.trim().normalize().toLocaleLowerCase('pt-BR'));
  return new Set(normalized).size === normalized.length ? null : 'Os nomes dos jogadores devem ser diferentes.';
}
