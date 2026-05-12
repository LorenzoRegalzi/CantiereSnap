import type { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
};

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  body: JSON.stringify(body),
});

export const ok = (data: unknown): APIGatewayProxyResult => json(200, data);

export const created = (data: unknown): APIGatewayProxyResult => json(201, data);

export const badRequest = (
  code: string,
  message: string,
  field?: string,
): APIGatewayProxyResult =>
  json(400, { error: { code, message, ...(field !== undefined ? { field } : {}) } });

export const notFound = (message = 'Resource not found.'): APIGatewayProxyResult =>
  json(404, { error: { code: 'NOT_FOUND', message } });

export const conflict = (message: string): APIGatewayProxyResult =>
  json(409, { error: { code: 'CONFLICT', message } });

export const unauthorized = (message: string): APIGatewayProxyResult =>
  json(401, { error: { code: 'UNAUTHORIZED', message } });

export const forbidden = (message = 'You do not have permission to access this resource.'): APIGatewayProxyResult =>
  json(403, { error: { code: 'FORBIDDEN', message } });

export const noContent = (): APIGatewayProxyResult => ({
  statusCode: 204,
  headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  body: '',
});

export const badGateway = (message = 'Upstream service unavailable. Please try again.'): APIGatewayProxyResult =>
  json(502, { error: { code: 'AI_SERVICE_UNAVAILABLE', message } });

export const internalError = (): APIGatewayProxyResult =>
  json(500, {
    error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred. Please try again later.' },
  });
