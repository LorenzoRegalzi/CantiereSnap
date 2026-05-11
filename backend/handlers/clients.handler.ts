import { randomUUID } from 'crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger } from '../shared/logger';
import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { ok, created, badRequest, notFound, internalError } from '../shared/response';

const TABLE = process.env.TABLE_NAME!;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Address {
  street: string;
  city: string;
  province: string;
  cap: string;
  country: string;
}

interface ClientItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'Client';
  clientId: string;
  clientName: string;
  email: string;
  phone?: string;
  codiceFiscale: string;
  partitaIva?: string;
  address: Address;
  createdAt: string;
  deletedAt?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+\d{7,15}$/;
const CODICE_FISCALE_RE = /^[A-Z0-9]{16}$/i;
const PARTITA_IVA_RE = /^IT\d{11}$/;

const ADDRESS_FIELDS = ['street', 'city', 'province', 'cap', 'country'] as const;

function validateAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object' || Array.isArray(addr))
    return 'address is required and must be an object.';
  const a = addr as Record<string, unknown>;
  for (const field of ADDRESS_FIELDS) {
    if (typeof a[field] !== 'string' || (a[field] as string).trim() === '')
      return `address.${field} is required.`;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.claims?.sub as string;
}

function parseBody<T>(event: APIGatewayProxyEvent): T {
  try {
    return JSON.parse(event.body ?? '{}') as T;
  } catch {
    return {} as T;
  }
}

const normalise = (name: string): string => name.toLowerCase().trim();

function toClientResponse(item: Partial<ClientItem>) {
  return {
    clientId: item.clientId,
    clientName: item.clientName,
    email: item.email,
    phone: item.phone ?? null,
    codiceFiscale: item.codiceFiscale,
    partitaIva: item.partitaIva ?? null,
    address: item.address,
    createdAt: item.createdAt,
  };
}

function encodeToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeToken(token: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function createClient(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody<{
    clientName?: string;
    email?: string;
    phone?: string;
    codiceFiscale?: string;
    partitaIva?: string;
    address?: unknown;
  }>(event);

  const name = body.clientName?.trim() ?? '';
  if (name.length < 2)
    return badRequest('VALIDATION_ERROR', 'clientName is required (minimum 2 characters).', 'clientName');
  if (name.length > 200)
    return badRequest('VALIDATION_ERROR', 'clientName must not exceed 200 characters.', 'clientName');

  if (!body.email || !EMAIL_RE.test(body.email))
    return badRequest('VALIDATION_ERROR', 'Invalid email address.', 'email');

  if (body.phone && !PHONE_RE.test(body.phone))
    return badRequest(
      'VALIDATION_ERROR',
      'phone must be in international format with + prefix (e.g. +393331234567).',
      'phone',
    );

  if (!body.codiceFiscale || !CODICE_FISCALE_RE.test(body.codiceFiscale))
    return badRequest(
      'VALIDATION_ERROR',
      'codiceFiscale must contain exactly 16 alphanumeric characters.',
      'codiceFiscale',
    );

  if (body.partitaIva && !PARTITA_IVA_RE.test(body.partitaIva))
    return badRequest(
      'VALIDATION_ERROR',
      'partitaIva must be in the format IT followed by 11 digits (e.g. IT12345678901).',
      'partitaIva',
    );

  const addrError = validateAddress(body.address);
  if (addrError) return badRequest('VALIDATION_ERROR', addrError, 'address');

  const clientId = randomUUID();
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${userId}`,
        SK: `CLIENT#${clientId}`,
        GSI1PK: `USER#${userId}`,
        GSI1SK: `CLIENT#${normalise(name)}`,
        entityType: 'Client',
        clientId,
        clientName: name,
        email: body.email,
        ...(body.phone ? { phone: body.phone } : {}),
        codiceFiscale: body.codiceFiscale.toUpperCase(),
        ...(body.partitaIva ? { partitaIva: body.partitaIva } : {}),
        address: body.address,
        createdAt: now,
      },
    }),
  );

  return created({
    clientId,
    clientName: name,
    email: body.email,
    phone: body.phone ?? null,
    codiceFiscale: body.codiceFiscale.toUpperCase(),
    partitaIva: body.partitaIva ?? null,
    address: body.address,
    createdAt: now,
  });
}

async function listClients(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const search = qs.search?.trim();
  const limit = Math.min(parseInt(qs.limit ?? '20', 10) || 20, 100);
  const exclusiveStartKey = qs.nextToken ? decodeToken(qs.nextToken) : undefined;

  let items: Record<string, unknown>[];
  let lastKey: Record<string, unknown> | undefined;

  if (search) {
    // AP-04: GSI-1 prefix search on normalised client name
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': `CLIENT#${normalise(search)}`,
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items = (result.Items ?? []) as Record<string, unknown>[];
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } else {
    // AP-03: main table query on user partition
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':prefix': 'CLIENT#',
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items = (result.Items ?? []) as Record<string, unknown>[];
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  }

  return ok({
    items: items.map((item) => toClientResponse(item as Partial<ClientItem>)),
    nextToken: lastKey ? encodeToken(lastKey) : null,
  });
}

async function getClient(userId: string, clientId: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `CLIENT#${clientId}` },
    }),
  );

  if (!result.Item || result.Item.deletedAt) return notFound('Client not found.');
  return ok(toClientResponse(result.Item as Partial<ClientItem>));
}

async function updateClient(
  event: APIGatewayProxyEvent,
  userId: string,
  clientId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody<{
    clientName?: string;
    email?: string;
    phone?: string;
    codiceFiscale?: string;
    partitaIva?: string;
    address?: unknown;
  }>(event);

  // Validate fields that were actually provided
  if (body.clientName !== undefined) {
    const name = body.clientName.trim();
    if (name.length < 2)
      return badRequest('VALIDATION_ERROR', 'clientName must be at least 2 characters.', 'clientName');
    if (name.length > 200)
      return badRequest('VALIDATION_ERROR', 'clientName must not exceed 200 characters.', 'clientName');
  }
  if (body.email !== undefined && !EMAIL_RE.test(body.email))
    return badRequest('VALIDATION_ERROR', 'Invalid email address.', 'email');
  if (typeof body.phone === 'string' && !PHONE_RE.test(body.phone))
    return badRequest(
      'VALIDATION_ERROR',
      'phone must be in international format with + prefix (e.g. +393331234567).',
      'phone',
    );
  if (body.codiceFiscale !== undefined && !CODICE_FISCALE_RE.test(body.codiceFiscale))
    return badRequest(
      'VALIDATION_ERROR',
      'codiceFiscale must contain exactly 16 alphanumeric characters.',
      'codiceFiscale',
    );
  if (typeof body.partitaIva === 'string' && !PARTITA_IVA_RE.test(body.partitaIva))
    return badRequest(
      'VALIDATION_ERROR',
      'partitaIva must be in the format IT followed by 11 digits (e.g. IT12345678901).',
      'partitaIva',
    );
  if (body.address !== undefined) {
    const addrError = validateAddress(body.address);
    if (addrError) return badRequest('VALIDATION_ERROR', addrError, 'address');
  }

  const UPDATABLE = ['clientName', 'email', 'phone', 'codiceFiscale', 'partitaIva', 'address'];
  if (!UPDATABLE.some((k) => k in (body as Record<string, unknown>)))
    return badRequest('VALIDATION_ERROR', 'No updatable fields provided.');

  const setClauses: string[] = [];
  const exprValues: Record<string, unknown> = {};

  if (body.clientName !== undefined) {
    const name = body.clientName.trim();
    setClauses.push('clientName = :clientName', 'GSI1SK = :gsi1sk');
    exprValues[':clientName'] = name;
    exprValues[':gsi1sk'] = `CLIENT#${normalise(name)}`;
  }
  if (body.email !== undefined) {
    setClauses.push('email = :email');
    exprValues[':email'] = body.email;
  }
  if (typeof body.phone === 'string') {
    setClauses.push('phone = :phone');
    exprValues[':phone'] = body.phone;
  }
  if (body.codiceFiscale !== undefined) {
    setClauses.push('codiceFiscale = :codiceFiscale');
    exprValues[':codiceFiscale'] = body.codiceFiscale.toUpperCase();
  }
  if (typeof body.partitaIva === 'string') {
    setClauses.push('partitaIva = :partitaIva');
    exprValues[':partitaIva'] = body.partitaIva;
  }
  if (body.address !== undefined) {
    setClauses.push('address = :address');
    exprValues[':address'] = body.address;
  }

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `CLIENT#${clientId}` },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return ok(toClientResponse(result.Attributes as Partial<ClientItem>));
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException')
      return notFound('Client not found.');
    throw err;
  }
}

async function deleteClient(userId: string, clientId: string): Promise<APIGatewayProxyResult> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `CLIENT#${clientId}` },
        UpdateExpression: 'SET deletedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }),
    );
    return ok({ message: 'Client deleted successfully.' });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException')
      return notFound('Client not found.');
    throw err;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('clients', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;
  const clientId = event.pathParameters?.clientId ?? '';

  try {
    if (resource === '/clients') {
      if (method === 'POST') return await createClient(event, userId);
      if (method === 'GET') return await listClients(event, userId);
    }
    if (resource === '/clients/{clientId}') {
      if (method === 'GET') return await getClient(userId, clientId);
      if (method === 'PATCH') return await updateClient(event, userId, clientId);
      if (method === 'DELETE') return await deleteClient(userId, clientId);
    }
    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
