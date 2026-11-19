export function resolveGameSchema(schema?: string): 'public' | 'bs_staging' {
  if (schema === undefined || schema === '' || schema === 'public') return 'public';
  if (schema === 'bs_staging') return schema;
  throw new Error('VITE_GAME_SCHEMA must be public or bs_staging.');
}

export function realtimeTopic(kind: 'user' | 'room', id: string): string {
  const prefix = resolveGameSchema(import.meta.env.VITE_GAME_SCHEMA) === 'bs_staging' ? 'hml:' : '';
  return `${prefix}${kind}:${id}`;
}
