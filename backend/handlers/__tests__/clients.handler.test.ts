import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { handler } from '../clients.handler';

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


const mockSend = docClient.send as jest.Mock;

// ── Test helpers ──────────────────────────────────────────────────────────────

const makeEvent = (
  method: string,
  resource: string,
  pathParameters: Record<string, string> | null = null,
  body: unknown = null,
  queryStringParameters: Record<string, string> | null = null,
): APIGatewayProxyEvent =>
  ({
    httpMethod: method,
    resource,
    path: resource,
    pathParameters,
    queryStringParameters,
    body: body !== null ? JSON.stringify(body) : null,
    requestContext: { authorizer: { claims: { sub: 'user-123' } } },
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  }) as unknown as APIGatewayProxyEvent;

const VALID_ADDRESS = {
  street: 'Via Garibaldi 15',
  city: 'Carmagnola',
  province: 'TO',
  cap: '10022',
  country: 'IT',
};

const VALID_CREATE_BODY = {
  clientName: 'Luigi Bianchi',
  email: 'luigi.bianchi@email.it',
  phone: '+393339876543',
  codiceFiscale: 'BNCLGU80A01H501Y',
  address: VALID_ADDRESS,
};

const CLIENT_ITEM = {
  PK: 'USER#user-123',
  SK: 'CLIENT#client-abc',
  GSI1PK: 'USER#user-123',
  GSI1SK: 'CLIENT#luigi bianchi',
  entityType: 'Client',
  clientId: 'client-abc',
  clientName: 'Luigi Bianchi',
  email: 'luigi.bianchi@email.it',
  phone: '+393339876543',
  codiceFiscale: 'BNCLGU80A01H501Y',
  address: VALID_ADDRESS,
  createdAt: '2026-05-01T10:00:00.000Z',
};

// ── POST /clients ─────────────────────────────────────────────────────────────

describe('POST /clients — createClient', () => {
  it('creates a client and returns 201 with correct shape', async () => {
    mockSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent('POST', '/clients', null, VALID_CREATE_BODY), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.clientId).toBeDefined();
    expect(body.clientName).toBe('Luigi Bianchi');
    expect(body.email).toBe('luigi.bianchi@email.it');
    expect(body.codiceFiscale).toBe('BNCLGU80A01H501Y');
    expect(body.address).toEqual(VALID_ADDRESS);
    expect(body.createdAt).toBeDefined();
  });

  it('uppercases codiceFiscale on save', async () => {
    mockSend.mockResolvedValueOnce({});

    const res = await handler(
      makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, codiceFiscale: 'bnclgu80a01h501y' }), ctx);

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).codiceFiscale).toBe('BNCLGU80A01H501Y');
  });

  it('creates client without optional fields (phone, partitaIva)', async () => {
    mockSend.mockResolvedValueOnce({});
    const { phone: _p, ...withoutPhone } = VALID_CREATE_BODY;

    const res = await handler(makeEvent('POST', '/clients', null, withoutPhone), ctx);

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).phone).toBeNull();
    expect(JSON.parse(res.body).partitaIva).toBeNull();
  });

  it('returns 400 when clientName is missing', async () => {
    const { clientName: _omit, ...rest } = VALID_CREATE_BODY;
    const res = await handler(makeEvent('POST', '/clients', null, rest), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('clientName');
  });

  it('returns 400 when clientName is too short', async () => {
    const res = await handler(makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, clientName: 'X' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('clientName');
  });

  it('returns 400 for an invalid email', async () => {
    const res = await handler(
      makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, email: 'non-una-email' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('email');
  });

  it('returns 400 for an invalid phone format', async () => {
    const res = await handler(
      makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, phone: '3331234567' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('phone');
  });

  it('returns 400 when codiceFiscale is missing', async () => {
    const { codiceFiscale: _omit, ...rest } = VALID_CREATE_BODY;
    const res = await handler(makeEvent('POST', '/clients', null, rest), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('codiceFiscale');
  });

  it('returns 400 when codiceFiscale has wrong length', async () => {
    const res = await handler(
      makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, codiceFiscale: 'TOOSHORT' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('codiceFiscale');
  });

  it('returns 400 for an invalid partitaIva format', async () => {
    const res = await handler(
      makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, partitaIva: '12345678901' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('partitaIva');
  });

  it('returns 400 when address is missing', async () => {
    const { address: _omit, ...rest } = VALID_CREATE_BODY;
    const res = await handler(makeEvent('POST', '/clients', null, rest), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('address');
  });

  it('returns 400 when an address sub-field is missing', async () => {
    const { city: _omit, ...addrWithoutCity } = VALID_ADDRESS;
    const res = await handler(
      makeEvent('POST', '/clients', null, { ...VALID_CREATE_BODY, address: addrWithoutCity }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('address');
    expect(JSON.parse(res.body).error.message).toContain('address.city');
  });

  it('returns 500 when DynamoDB throws unexpectedly', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));
    const res = await handler(makeEvent('POST', '/clients', null, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /clients ──────────────────────────────────────────────────────────────

describe('GET /clients — listClients', () => {
  it('lists all clients from the main table', async () => {
    mockSend.mockResolvedValueOnce({ Items: [CLIENT_ITEM], LastEvaluatedKey: undefined });

    const res = await handler(makeEvent('GET', '/clients'), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].clientId).toBe('client-abc');
    expect(body.nextToken).toBeNull();
  });

  it('queries StatusIndex (GSI-1) when search param is provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [CLIENT_ITEM] });

    const res = await handler(makeEvent('GET', '/clients', null, null, { search: 'Luigi' }), ctx);
    expect(res.statusCode).toBe(200);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('StatusIndex');
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('CLIENT#luigi');
  });

  it('normalises search term to lowercase', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/clients', null, null, { search: 'BIANCHI' }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('CLIENT#bianchi');
  });

  it('returns a nextToken when more pages exist', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'CLIENT#client-abc' };
    mockSend.mockResolvedValueOnce({ Items: [CLIENT_ITEM], LastEvaluatedKey: lastKey });

    const res = await handler(makeEvent('GET', '/clients'), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).nextToken).not.toBeNull();
  });

  it('decodes nextToken into ExclusiveStartKey', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'CLIENT#client-abc' };
    const token = Buffer.from(JSON.stringify(lastKey)).toString('base64');
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await handler(makeEvent('GET', '/clients', null, null, { nextToken: token }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExclusiveStartKey).toEqual(lastKey);
  });
});

// ── GET /clients/{clientId} ───────────────────────────────────────────────────

describe('GET /clients/{clientId} — getClient', () => {
  it('returns the full client object', async () => {
    mockSend.mockResolvedValueOnce({ Item: CLIENT_ITEM });

    const res = await handler(makeEvent('GET', '/clients/{clientId}', { clientId: 'client-abc' }), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.clientId).toBe('client-abc');
    expect(body.address).toEqual(VALID_ADDRESS);
  });

  it('returns 404 when client does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('GET', '/clients/{clientId}', { clientId: 'missing' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a soft-deleted client', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...CLIENT_ITEM, deletedAt: '2026-05-02T10:00:00.000Z' } });

    const res = await handler(makeEvent('GET', '/clients/{clientId}', { clientId: 'client-abc' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH /clients/{clientId} ─────────────────────────────────────────────────

describe('PATCH /clients/{clientId} — updateClient', () => {
  it('updates email and returns the updated client', async () => {
    mockSend.mockResolvedValueOnce({
      Attributes: { ...CLIENT_ITEM, email: 'new@example.it' },
    });

    const res = await handler(
      makeEvent('PATCH', '/clients/{clientId}', { clientId: 'client-abc' }, { email: 'new@example.it' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).email).toBe('new@example.it');
  });

  it('updates GSI1SK when clientName changes', async () => {
    mockSend.mockResolvedValueOnce({
      Attributes: { ...CLIENT_ITEM, clientName: 'Marco Rossi' },
    });

    await handler(
      makeEvent('PATCH', '/clients/{clientId}', { clientId: 'client-abc' }, { clientName: 'Marco Rossi' }), ctx);

    const updateInput = mockSend.mock.calls[0][0].input;
    expect(updateInput.ExpressionAttributeValues[':gsi1sk']).toBe('CLIENT#marco rossi');
  });

  it('returns 400 for an invalid email', async () => {
    const res = await handler(
      makeEvent('PATCH', '/clients/{clientId}', { clientId: 'client-abc' }, { email: 'non-email' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('email');
  });

  it('returns 400 for an invalid phone format', async () => {
    const res = await handler(
      makeEvent('PATCH', '/clients/{clientId}', { clientId: 'client-abc' }, { phone: '0331234567' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('phone');
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const res = await handler(
      makeEvent('PATCH', '/clients/{clientId}', { clientId: 'client-abc' }, {}), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when address sub-field is missing', async () => {
    const { province: _omit, ...addrMissingProvince } = VALID_ADDRESS;
    const res = await handler(
      makeEvent(
        'PATCH',
        '/clients/{clientId}',
        { clientId: 'client-abc' },
        { address: addrMissingProvince },
      ), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('address.province');
  });

  it('returns 404 when client does not exist (ConditionalCheckFailed)', async () => {
    const err = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(err);

    const res = await handler(
      makeEvent('PATCH', '/clients/{clientId}', { clientId: 'missing' }, { email: 'a@b.it' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE /clients/{clientId} ────────────────────────────────────────────────

describe('DELETE /clients/{clientId} — deleteClient', () => {
  it('soft-deletes the client and returns 200', async () => {
    mockSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent('DELETE', '/clients/{clientId}', { clientId: 'client-abc' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBeDefined();

    const updateInput = mockSend.mock.calls[0][0].input;
    expect(updateInput.UpdateExpression).toContain('deletedAt');
    expect(updateInput.ConditionExpression).toContain('attribute_not_exists(deletedAt)');
  });

  it('returns 404 when client does not exist (ConditionalCheckFailed)', async () => {
    const err = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(err);

    const res = await handler(makeEvent('DELETE', '/clients/{clientId}', { clientId: 'missing' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when trying to delete an already-deleted client', async () => {
    const err = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(err);

    const res = await handler(
      makeEvent('DELETE', '/clients/{clientId}', { clientId: 'client-abc' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});
