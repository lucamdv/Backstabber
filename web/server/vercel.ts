import { attachDatabasePool } from '@vercel/functions';
import { handleRequest } from './http';

export const vercelRequest = (request: Request) => handleRequest(request, attachDatabasePool);
