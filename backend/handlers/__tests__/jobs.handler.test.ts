import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { handler } from '../jobs.handler';

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

const JOB_ITEM = {
  PK: 'USER#user-123',
  SK: 'JOB#00001',
  GSI1PK: 'USER#user-123',
  GSI1SK: 'JOB#Quote#2026-05-01T10:00:00.000Z',
  GSI2PK: 'USER_JOBS#user-123',
  GSI2SK: '2026-05-01T10:00:00.000Z',
  entityType: 'Job',
  jobId: 1,
  clientId: 'client-abc',
  clientName: 'Luigi Bianchi',
  description: 'Rifacimento impianto idraulico bagno principale',
  address: 'Via Roma 1, Carmagnola (TO)',
  targetDate: '2026-06-01',
  status: 'Quote',
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
};

const VALID_CREATE_BODY = {
  clientId: 'client-abc',
  description: 'Rifacimento impianto idraulico bagno principale.',
  address: 'Via Roma 1, Carmagnola (TO)',
  targetDate: '2026-12-01',
};

// ── POST /jobs ────────────────────────────────────────────────────────────────

describe('POST /jobs — createJob', () => {
  it('creates a job and returns 201 with correct shape', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { clientName: 'Luigi Bianchi' } }) // GetItem client
      .mockResolvedValueOnce({ Attributes: { lastJobId: 1 } })          // UpdateItem counter
      .mockResolvedValueOnce({});                                        // PutItem job

    const res = await handler(makeEvent('POST', '/jobs', null, VALID_CREATE_BODY), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.jobId).toBe(1);
    expect(body.jobIdFormatted).toBe('00001');
    expect(body.clientName).toBe('Luigi Bianchi');
    expect(body.status).toBe('Quote');
    expect(body.createdAt).toBeDefined();
  });

  it('returns 400 when clientId is missing', async () => {
    const { clientId: _omit, ...rest } = VALID_CREATE_BODY;
    const res = await handler(makeEvent('POST', '/jobs', null, rest), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('clientId');
  });

  it('returns 400 when description is shorter than 10 characters', async () => {
    const res = await handler(makeEvent('POST', '/jobs', null, { ...VALID_CREATE_BODY, description: 'Corto' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('description');
  });

  it('returns 400 when address is missing', async () => {
    const { address: _omit, ...rest } = VALID_CREATE_BODY;
    const res = await handler(makeEvent('POST', '/jobs', null, rest), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('address');
  });

  it('returns 400 when targetDate is in the past', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs', null, { ...VALID_CREATE_BODY, targetDate: '2020-01-01' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('targetDate');
  });

  it('returns 400 when targetDate format is invalid', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs', null, { ...VALID_CREATE_BODY, targetDate: '01/12/2026' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('targetDate');
  });

  it('returns 404 when client does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(makeEvent('POST', '/jobs', null, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 when DynamoDB throws unexpectedly', async () => {
    mockSend.mockResolvedValueOnce({ Item: { clientName: 'Luigi Bianchi' } });
    mockSend.mockRejectedValueOnce(new Error('DynamoDB connection error'));
    const res = await handler(makeEvent('POST', '/jobs', null, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /jobs ─────────────────────────────────────────────────────────────────

describe('GET /jobs — listJobs', () => {
  it('returns all jobs (no filters)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [JOB_ITEM], LastEvaluatedKey: undefined });

    const res = await handler(makeEvent('GET', '/jobs'), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].jobIdFormatted).toBe('00001');
    expect(body.nextToken).toBeNull();
  });

  it('queries StatusIndex when status filter is provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [JOB_ITEM] });

    const res = await handler(makeEvent('GET', '/jobs', null, null, { status: 'Quote' }), ctx);
    expect(res.statusCode).toBe(200);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('StatusIndex');
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('JOB#Quote#');
  });

  it('queries DueDateIndex when startDate/endDate are provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [JOB_ITEM] });

    const res = await handler(
      makeEvent('GET', '/jobs', null, null, { startDate: '2026-05-01', endDate: '2026-05-31' }), ctx);
    expect(res.statusCode).toBe(200);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('DueDateIndex');
  });

  it('returns 400 for an unknown status value', async () => {
    const res = await handler(makeEvent('GET', '/jobs', null, null, { status: 'NonEsiste' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a nextToken when more pages exist', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'JOB#00001' };
    mockSend.mockResolvedValueOnce({ Items: [JOB_ITEM], LastEvaluatedKey: lastKey });

    const res = await handler(makeEvent('GET', '/jobs'), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).nextToken).not.toBeNull();
  });

  it('decodes nextToken into ExclusiveStartKey', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'JOB#00001' };
    const token = Buffer.from(JSON.stringify(lastKey)).toString('base64');
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await handler(makeEvent('GET', '/jobs', null, null, { nextToken: token }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExclusiveStartKey).toEqual(lastKey);
  });
});

// ── GET /jobs/{jobId} ─────────────────────────────────────────────────────────

describe('GET /jobs/{jobId} — getJob', () => {
  it('returns the job', async () => {
    mockSend.mockResolvedValueOnce({ Item: JOB_ITEM });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}', { jobId: '1' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).jobId).toBe(1);
  });

  it('returns 404 when job does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}', { jobId: '999' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a cancelled job', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...JOB_ITEM, status: 'Cancelled' } });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}', { jobId: '1' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a non-numeric jobId', async () => {
    const res = await handler(makeEvent('GET', '/jobs/{jobId}', { jobId: 'abc' }), ctx);
    expect(res.statusCode).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── GET /jobs/{jobId}/details ─────────────────────────────────────────────────

describe('GET /jobs/{jobId}/details — getJobDetails', () => {
  it('returns job with grouped child entities', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: JOB_ITEM }) // GetItem job header
      .mockResolvedValueOnce({                    // Query job partition
        Items: [
          {
            entityType: 'StatusTransition',
            fromStatus: null,
            toStatus: 'Quote',
            changedAt: '2026-05-01T10:00:00.000Z',
          },
          {
            entityType: 'Quote',
            totalAmount: 2850,
            currency: 'EUR',
            status: 'Draft',
            createdAt: '2026-05-01T11:00:00.000Z',
          },
          {
            entityType: 'QuoteItem',
            seq: 1,
            description: 'Rimozione impianto',
            quantity: 1,
            unit: 'intervento',
            unitPrice: 350,
            lineTotal: 350,
          },
        ],
      });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/details', { jobId: '1' }), ctx);
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.job.jobId).toBe(1);
    expect(body.statusHistory).toHaveLength(1);
    expect(body.statusHistory[0].toStatus).toBe('Quote');
    expect(body.quote.totalAmount).toBe(2850);
    expect(body.quote.items).toHaveLength(1);
    expect(body.photos).toHaveLength(0);
    expect(body.materials).toHaveLength(0);
    expect(body.invoice).toBeNull();
  });

  it('returns 404 when job does not exist', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/details', { jobId: '999' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH /jobs/{jobId} ───────────────────────────────────────────────────────

describe('PATCH /jobs/{jobId} — updateJob', () => {
  it('updates description and returns the updated job', async () => {
    mockSend.mockResolvedValueOnce({
      Attributes: {
        ...JOB_ITEM,
        description: 'Nuova descrizione dettagliata del lavoro.',
        updatedAt: '2026-05-02T10:00:00.000Z',
      },
    });

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}', { jobId: '1' }, { description: 'Nuova descrizione dettagliata del lavoro.' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).description).toBe('Nuova descrizione dettagliata del lavoro.');
  });

  it('returns 400 when description is too short', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}', { jobId: '1' }, { description: 'Breve' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('description');
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}', { jobId: '1' }, {}), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when targetDate format is invalid', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}', { jobId: '1' }, { targetDate: 'non-una-data' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('targetDate');
  });

  it('returns 404 when job does not exist (ConditionalCheckFailed)', async () => {
    const err = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(err);

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}', { jobId: '999' }, { address: 'Via Nuova 42, Torino' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH /jobs/{jobId}/status ────────────────────────────────────────────────

describe('PATCH /jobs/{jobId}/status — updateJobStatus', () => {
  it('advances Quote → Accepted and returns transition info', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: JOB_ITEM }) // GetItem current job
      .mockResolvedValueOnce({});                 // TransactWriteCommand

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '1' }, { status: 'Accepted' }), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.previousStatus).toBe('Quote');
    expect(body.newStatus).toBe('Accepted');
    expect(body.transitionTimestamp).toBeDefined();
  });

  it('returns 400 when status value is not in the enum', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '1' }, { status: 'NonEsiste' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a non-sequential transition (Quote → InProgress)', async () => {
    mockSend.mockResolvedValueOnce({ Item: JOB_ITEM }); // current status is Quote

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '1' }, { status: 'InProgress' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 409 when moving to Invoiced without an invoice', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...JOB_ITEM, status: 'Completed' } }) // current job
      .mockResolvedValueOnce({ Item: undefined });                            // invoice check → missing

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '1' }, { status: 'Invoiced' }), ctx);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('returns 200 when moving to Invoiced and invoice exists', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...JOB_ITEM, status: 'Completed' } }) // current job
      .mockResolvedValueOnce({ Item: { PK: 'JOB#user-123#00001', SK: 'INVOICE' } }) // invoice found
      .mockResolvedValueOnce({});                                              // TransactWrite

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '1' }, { status: 'Invoiced' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).newStatus).toBe('Invoiced');
  });

  it('returns 404 when job does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '999' }, { status: 'Accepted' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when status field is missing from body', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/status', { jobId: '1' }, {}), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('status');
  });
});

// ── DELETE /jobs/{jobId} ──────────────────────────────────────────────────────

describe('DELETE /jobs/{jobId} — deleteJob', () => {
  it('soft-deletes the job and returns 200', async () => {
    mockSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: '1' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBeDefined();

    const updateInput = mockSend.mock.calls[0][0].input;
    expect(updateInput.ExpressionAttributeValues[':cancelled']).toBe('Cancelled');
  });

  it('returns 404 when job does not exist (ConditionalCheckFailed)', async () => {
    const err = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend.mockRejectedValueOnce(err);

    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: '999' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a non-numeric jobId without calling DynamoDB', async () => {
    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: 'abc' }), ctx);
    expect(res.statusCode).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
