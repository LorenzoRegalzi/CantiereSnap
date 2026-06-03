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
    // Handler fans out one QueryCommand per status (5 total) via Promise.all
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] }) // Quote
      .mockResolvedValueOnce({ Items: [] })          // Accepted
      .mockResolvedValueOnce({ Items: [] })          // InProgress
      .mockResolvedValueOnce({ Items: [] })          // Completed
      .mockResolvedValueOnce({ Items: [] });         // Invoiced

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

  it('queries StatusIndex with targetDate filter when startDate/endDate are provided', async () => {
    // Bug fix: DueDateIndex projected too few fields; handler now uses StatusIndex with
    // a FilterExpression on targetDate. One QueryCommand per status (5 total).
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] }) // Quote
      .mockResolvedValueOnce({ Items: [] })          // Accepted
      .mockResolvedValueOnce({ Items: [] })          // InProgress
      .mockResolvedValueOnce({ Items: [] })          // Completed
      .mockResolvedValueOnce({ Items: [] });         // Invoiced

    const res = await handler(
      makeEvent('GET', '/jobs', null, null, { startDate: '2026-05-01', endDate: '2026-05-31' }), ctx);
    expect(res.statusCode).toBe(200);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('StatusIndex');
    expect(queryInput.FilterExpression).toContain('targetDate');
    expect(queryInput.ExpressionAttributeValues[':start']).toBe('2026-05-01');
    expect(queryInput.ExpressionAttributeValues[':end']).toBe('2026-05-31');
  });

  it('returns 400 for an unknown status value', async () => {
    const res = await handler(makeEvent('GET', '/jobs', null, null, { status: 'NonEsiste' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a nextToken when more pages exist', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'JOB#00001' };
    // Handler fans out 5 queries; nextToken comes from the last result's LastEvaluatedKey
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: lastKey });

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
    // getJobDetails returns a flat response — job fields are at the top level
    expect(body.jobId).toBe(1);
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
    // Bug fix: soft delete now reads createdAt first so GSI1SK can be updated to
    // JOB#Cancelled#<createdAt>, removing the item from all valid-status index ranges.
    mockSend
      .mockResolvedValueOnce({ Item: { createdAt: '2026-05-01T10:00:00.000Z', status: 'Quote' } }) // GetItem
      .mockResolvedValueOnce({});                                                                   // UpdateItem

    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: '1' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toBeDefined();

    const updateInput = mockSend.mock.calls[1][0].input;
    expect(updateInput.ExpressionAttributeValues[':cancelled']).toBe('Cancelled');
    expect(updateInput.UpdateExpression).toContain('GSI1SK');
  });

  it('returns 404 when job does not exist (ConditionalCheckFailed on update)', async () => {
    // GetItem succeeds (item exists), but the conditional update fails concurrently
    const err = Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    });
    mockSend
      .mockResolvedValueOnce({ Item: { createdAt: '2026-05-01T10:00:00.000Z', status: 'Quote' } }) // GetItem
      .mockRejectedValueOnce(err);                                                                  // UpdateItem

    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: '999' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when job does not exist (GetItem returns nothing)', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: '999' }), ctx);
    expect(res.statusCode).toBe(404);
    expect(mockSend).toHaveBeenCalledTimes(1); // no UpdateItem attempted
  });

  it('returns 404 for a non-numeric jobId without calling DynamoDB', async () => {
    const res = await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: 'abc' }), ctx);
    expect(res.statusCode).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── Bug regression tests ──────────────────────────────────────────────────────
// One test per backend bug found and fixed during the June 2026 frontend phase.

describe('Regression: Cancelled guard on no-filter GSI-1 query', () => {
  it('excludes Cancelled jobs via FilterExpression even when no status filter is given', async () => {
    // Bug: the no-filter listJobs path queried the main table (PK = USER#userId) and
    // had no FilterExpression, so Cancelled jobs appeared in results.
    // Fix: query StatusIndex per-status with FilterExpression #jobStatus <> :cancelled.
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/jobs'), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('StatusIndex');
    expect(queryInput.FilterExpression).toContain(':cancelled');
    expect(queryInput.ExpressionAttributeValues[':cancelled']).toBe('Cancelled');
  });

  it('does not query for Cancelled status prefix', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/jobs'), ctx);

    const prefixes = mockSend.mock.calls.map(
      (call) => call[0].input.ExpressionAttributeValues[':prefix'],
    );
    expect(prefixes.every((p: string) => !p.includes('Cancelled'))).toBe(true);
  });
});

describe('Regression: Date range filter uses StatusIndex (not DueDateIndex)', () => {
  it('applies targetDate BETWEEN filter via FilterExpression, not a key condition', async () => {
    // Bug: handler queried DueDateIndex whose GSI2SK stores createdAt (not targetDate)
    // and projected too few attributes. Fix: use StatusIndex + FilterExpression on targetDate.
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/jobs', null, null, { startDate: '2026-06-01', endDate: '2026-06-30' }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('StatusIndex');
    // targetDate filter must be in FilterExpression, not KeyConditionExpression
    expect(queryInput.FilterExpression).toContain('targetDate');
    expect(queryInput.KeyConditionExpression).not.toContain('targetDate');
  });
});

// ── Additional branch coverage ─────────────────────────────────────────────────

describe('GET /jobs — listJobs additional branches', () => {
  it('applies startDate-only filter (no endDate)', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs', null, null, { startDate: '2026-06-01' }), ctx);
    expect(res.statusCode).toBe(200);
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.FilterExpression).toContain(':start');
    expect(queryInput.ExpressionAttributeValues[':start']).toBe('2026-06-01');
    expect(queryInput.ExpressionAttributeValues[':end']).toBeUndefined();
  });

  it('applies endDate-only filter (no startDate)', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs', null, null, { endDate: '2026-06-30' }), ctx);
    expect(res.statusCode).toBe(200);
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.FilterExpression).toContain(':end');
    expect(queryInput.ExpressionAttributeValues[':end']).toBe('2026-06-30');
    expect(queryInput.ExpressionAttributeValues[':start']).toBeUndefined();
  });

  it('applies search filter combined with status filter', async () => {
    mockSend.mockResolvedValueOnce({ Items: [JOB_ITEM] });

    const res = await handler(
      makeEvent('GET', '/jobs', null, null, { status: 'Quote', search: 'bagno' }), ctx);
    expect(res.statusCode).toBe(200);
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.FilterExpression).toContain(':search');
    expect(queryInput.ExpressionAttributeValues[':search']).toBe('bagno');
  });

  it('applies search filter on no-filter path', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [JOB_ITEM] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs', null, null, { search: 'idraulico' }), ctx);
    expect(res.statusCode).toBe(200);
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.FilterExpression).toContain(':search');
  });

  it('ignores a malformed nextToken and proceeds without ExclusiveStartKey', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs', null, null, { nextToken: '!!!not-base64!!!' }), ctx);
    expect(res.statusCode).toBe(200);
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExclusiveStartKey).toBeUndefined();
  });

  it('returns 400 when all supplied status values are invalid', async () => {
    const res = await handler(makeEvent('GET', '/jobs', null, null, { status: 'Foo,Bar' }), ctx);
    expect(res.statusCode).toBe(400);
  });
});

describe('Unknown route', () => {
  it('returns 404 for an unrecognised resource', async () => {
    const res = await handler(makeEvent('GET', '/unknown-resource'), ctx);
    expect(res.statusCode).toBe(404);
  });
});

describe('Regression: Soft delete updates GSI1SK', () => {
  it('UpdateExpression sets GSI1SK to JOB#Cancelled#<createdAt>', async () => {
    // Bug: soft delete only set status = Cancelled but left GSI1SK = JOB#Quote#...
    // so the job still appeared in GSI-1 range scans for Quote status.
    const createdAt = '2026-05-01T10:00:00.000Z';
    mockSend
      .mockResolvedValueOnce({ Item: { createdAt, status: 'Quote' } })
      .mockResolvedValueOnce({});

    await handler(makeEvent('DELETE', '/jobs/{jobId}', { jobId: '1' }), ctx);

    const updateInput = mockSend.mock.calls[1][0].input;
    expect(updateInput.UpdateExpression).toMatch(/GSI1SK/);
    expect(updateInput.ExpressionAttributeValues[':gsi1sk']).toBe(`JOB#Cancelled#${createdAt}`);
  });
});
