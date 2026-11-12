export interface OnlineApi {
  request<T>(path: string, method?: string, body?: unknown): Promise<T>;
}

export class OnlineApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'OnlineApiError';
  }
}

type ApiOptions = {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  refreshToken: () => Promise<string | null>;
  fetch?: typeof fetch;
};

function sessionExpired() {
  return new OnlineApiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre com o Google novamente.');
}

const messages: Readonly<Record<string, string>> = {
  USERNAME_TAKEN: 'Esse nome de usuário já está em uso.',
  INVALID_PROFILE: 'Confira o nome de usuário e o nome de exibição.',
  INVALID_AVATAR: 'Use um endereço HTTPS válido para o avatar.',
  INVALID_ROOM_CODE: 'Confira os 10 caracteres do código da sala.',
  ROOM_NOT_FOUND: 'Essa sala não existe ou não está acessível.',
  ROOM_NOT_OPEN: 'Essa sala já iniciou a partida ou foi encerrada.',
  ROOM_FULL: 'Essa sala está lotada.',
  ROOM_NOT_READY: 'A sala precisa de dois ou mais jogadores conectados e prontos.',
  HOST_REQUIRED: 'Somente o anfitrião pode executar esta operação.',
  FRIEND_REQUEST_EXISTS: 'Já existe uma solicitação de amizade entre vocês.',
  FRIEND_REQUEST_NOT_FOUND: 'Essa solicitação de amizade já foi resolvida ou não está acessível.',
  ALREADY_FRIENDS: 'Vocês já são amigos.',
  ALREADY_IN_ROOM: 'Esse amigo já está na sala.',
  INVITE_EXISTS: 'Esse amigo já tem um convite pendente para a sala.',
  INVITE_NOT_FOUND: 'Esse convite expirou ou não está mais disponível.',
  SERVICE_UNAVAILABLE: 'O serviço online está indisponível no momento.',
};

function errorField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? Reflect.get(value, key) : undefined;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) throw sessionExpired();
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.ok) {
      throw new OnlineApiError(502, 'INVALID_RESPONSE', 'A API online não retornou uma resposta válida.');
    }
  }
  if (response.ok) return body as T;
  const error = errorField(body, 'error');
  const rawCode = errorField(error, 'code') ?? errorField(body, 'code') ?? error;
  const code = typeof rawCode === 'string' ? rawCode : 'REQUEST_FAILED';
  const message = errorField(error, 'message') ?? errorField(body, 'message');
  throw new OnlineApiError(
    response.status, code, typeof message === 'string' ? message
      : (Object.hasOwn(messages, code) ? messages[code] : 'Não foi possível concluir a operação online.'),
  );
}

export function createOnlineApi(options: ApiOptions): OnlineApi {
  const send = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    async request<T>(path: string, method = 'GET', body?: unknown) {
      if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Caminho de API inválido.');
      const request = (token: string) => send(baseUrl + path, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Preserve same-origin Vercel Authentication cookies on protected previews.
        // Cross-origin API endpoints still receive no cookies.
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });

      const token = await options.getToken();
      if (!token) throw sessionExpired();
      const response = await request(token);
      if (response.status !== 401) return readResponse<T>(response);
      const freshToken = await options.refreshToken();
      if (!freshToken) throw sessionExpired();
      return readResponse<T>(await request(freshToken));
    },
  };
}

export function onlineErrorMessage(error: unknown) {
  if (error instanceof OnlineApiError) return error.message;
  return 'A conexão com o serviço online falhou. Tente novamente.';
}
