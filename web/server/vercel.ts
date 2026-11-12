import { attachDatabasePool } from '@vercel/functions';
import { handleRequest } from './http.js';

export const vercelRequest = (request: Request) => handleRequest(request, attachDatabasePool);
