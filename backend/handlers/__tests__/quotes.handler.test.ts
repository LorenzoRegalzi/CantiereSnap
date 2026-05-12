import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { putObject, getPresignedUrl } from '../../shared/s3';
import { anthropicClient } from '../../shared/anthropic';
import { handler } from '../quotes.handler';

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/s3', () => ({
  putObject: jest.fn(),
  getPresignedUrl: jest.fn(),
}));

jest.mock('../../shared/anthropic', () => ({
  anthropicClient: { messages: { create: jest.fn() } },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const callbacks: Record<string, (arg?: unknown) => void> = {};
    return {
      fontSize: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation((event: string, cb: (arg?: unknown) => void) => {
        callbacks[event] = cb;
      }),
      end: jest.fn().mockImplementation(() => {
        if (callbacks['end']) callbacks['end']();
      }),
      y: 100,
    };
  });
});

const mockDynamo = docClient.send as jest.Mock;
const mockPutObject = putObject as jest.Mock;
const mockGetPresignedUrl = getPresignedUrl as jest.Mock;
const mockAnthropic = anthropicClient.messages.create as jest.Mock;

// ── Test helpers ──────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';
const JOB_ID = '3';
const JOB_ID_PADDED = '00003';

const makeEvent = (
  method: string,
  resource: string,
  body: unknown = null,
  pathParameters: Record<string, string> | null = { jobId: JOB_ID },
): APIGatewayProxyEvent =>
  ({
    httpMethod: method,
    resource,
    path: resource.replace('{jobId}', JOB_ID),
    pathParameters,
    queryStringParameters: null,
    body: body !== null ? JSON.stringify(body) : null,
    requestContext: { authorizer: { claims: { sub: USER_ID } } },
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  }) as unknown as APIGatewayProxyEvent;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ITEM = {
  PK: `USER#${USER_ID}`,
  SK: `JOB#${JOB_ID_PADDED}`,
  status: 'Quote',
  clientName: 'Luigi Bianchi',
  description: 'Rifacimento bagno',
  createdAt: '2026-05-01T10:00:00.000Z',
};

const QUOTE_HEADER = {
  PK: `JOB#${USER_ID}#${JOB_ID_PADDED}`,
  SK: 'QUOTE',
  entityType: 'Quote',
  totalAmount: 2850,
  currency: 'EUR',
  status: 'Draft',
  itemCount: 2,
  createdAt: '2026-05-02T10:00:00.000Z',
  updatedAt: '2026-05-02T10:00:00.000Z',
};

const QUOTE_ITEM_1 = {
  PK: `JOB#${USER_ID}#${JOB_ID_PADDED}`,
  SK: 'QUOTE#ITEM#001',
  entityType: 'QuoteItem',
  seq: 1,
  description: 'Rimozione impianto idraulico',
  quantity: 1,
  unit: 'intervento',
  unitPrice: 350,
  lineTotal: 350,
};

const QUOTE_ITEM_2 = {
  PK: `JOB#${USER_ID}#${JOB_ID_PADDED}`,
  SK: 'QUOTE#ITEM#002',
  entityType: 'QuoteItem',
  seq: 2,
  description: 'Installazione tubazioni multistrato',
  quantity: 15,
  unit: 'ml',
  unitPrice: 28,
  lineTotal: 420,
};

const AI_ITEMS_JSON = JSON.stringify([
  { seq: 1, description: 'Rimozione impianto idraulico', quantity: 1, unit: 'intervento', unitPrice: 350, lineTotal: 350 },
  { seq: 2, description: 'Installazione tubazioni multistrato', quantity: 15, unit: 'ml', unitPrice: 28, lineTotal: 420 },
]);

const VALID_DESCRIPTION = 'Devo rifare il bagno principale, smontaggio e posa piastrelle, impianto idraulico completo.';

const VALID_ITEMS_BODY = {
  items: [
    { description: 'Rimozione piastrelle esistenti', quantity: 10, unit: 'mq', unitPrice: 25 },
    { description: 'Posa nuove piastrelle', quantity: 10, unit: 'mq', unitPrice: 45 },
  ],
};

// ── POST /jobs/{jobId}/quote — generateQuote ──────────────────────────────────

describe('POST /jobs/{jobId}/quote — generateQuote', () => {
  it('returns 201 with generated quote and items', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })    // GetItem job
      .mockResolvedValueOnce({ Item: undefined })    // GetItem quote (not found)
      .mockResolvedValueOnce({});                    // TransactWrite

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.quote.totalAmount).toBe(770);
    expect(body.quote.status).toBe('Draft');
    expect(body.quote.model).toBe('claude-sonnet-4-6');
    expect(body.quote.itemCount).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].seq).toBe(1);
  });

  it('stores quote metadata with correct fields in DynamoDB', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const quotePut = transactInput.TransactItems[0].Put.Item;
    expect(quotePut.PK).toBe(`JOB#${USER_ID}#${JOB_ID_PADDED}`);
    expect(quotePut.SK).toBe('QUOTE');
    expect(quotePut.entityType).toBe('Quote');
    expect(quotePut.model).toBe('claude-sonnet-4-6');
    expect(quotePut.inputLength).toBe(VALID_DESCRIPTION.length);
    expect(quotePut.currency).toBe('EUR');
  });

  it('stores line items with correct SK format', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const item1Put = transactInput.TransactItems[1].Put.Item;
    expect(item1Put.SK).toBe('QUOTE#ITEM#001');
    expect(item1Put.entityType).toBe('QuoteItem');
    const item2Put = transactInput.TransactItems[2].Put.Item;
    expect(item2Put.SK).toBe('QUOTE#ITEM#002');
  });

  it('calls Claude with correct model and token limits', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    const aiCall = mockAnthropic.mock.calls[0][0];
    expect(aiCall.model).toBe('claude-sonnet-4-6');
    expect(aiCall.max_tokens).toBe(1500);
    expect(aiCall.system).toContain('Italian');
    expect(aiCall.messages[0].role).toBe('user');
    expect(aiCall.messages[0].content).toContain(VALID_DESCRIPTION);
  });

  it('includes optional notes in the AI prompt', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });

    const notes = 'Usare piastrelle Marazzi';
    await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION, notes }), ctx);

    const aiCall = mockAnthropic.mock.calls[0][0];
    expect(aiCall.messages[0].content).toContain(notes);
  });

  it('returns 400 when description is too short', async () => {
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: 'Too short' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('description');
  });

  it('returns 404 when job not found', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when quote already exists', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: QUOTE_HEADER });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('returns 502 when Anthropic API throws', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined });

    mockAnthropic.mockRejectedValueOnce(new Error('Connection timeout'));

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('returns 502 when AI returns invalid JSON', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined });

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sorry, I cannot generate a quote.' }],
    });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(502);
  });

  it('parses JSON embedded in surrounding text', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: `Here is the quote:\n${AI_ITEMS_JSON}\nEnd of quote.` }],
    });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).items).toHaveLength(2);
  });

  it('recalculates lineTotal server-side (ignores AI value)', async () => {
    const itemsWithWrongTotal = JSON.stringify([
      { seq: 1, description: 'Lavori idraulici', quantity: 2, unit: 'ore', unitPrice: 50, lineTotal: 999 },
    ]);
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: itemsWithWrongTotal }],
    });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    const body = JSON.parse(res.body);
    expect(body.items[0].lineTotal).toBe(100); // 2 × 50
    expect(body.quote.totalAmount).toBe(100);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB down'));

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /jobs/{jobId}/quote — getQuote ────────────────────────────────────────

describe('GET /jobs/{jobId}/quote — getQuote', () => {
  it('returns 200 with quote header and sorted items', async () => {
    mockDynamo.mockResolvedValueOnce({
      Items: [QUOTE_HEADER, QUOTE_ITEM_2, QUOTE_ITEM_1],
    });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/quote'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.quote.totalAmount).toBe(2850);
    expect(body.quote.status).toBe('Draft');
    expect(body.items).toHaveLength(2);
    expect(body.items[0].seq).toBe(1);
    expect(body.items[1].seq).toBe(2);
  });

  it('returns pdfS3Key as null when not yet generated', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [QUOTE_HEADER] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/quote'), ctx);
    const body = JSON.parse(res.body);
    expect(body.quote.pdfS3Key).toBeNull();
  });

  it('returns 404 when no quote exists', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/quote'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('queries with QUOTE prefix to get header and items together', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [QUOTE_HEADER, QUOTE_ITEM_1] });

    await handler(makeEvent('GET', '/jobs/{jobId}/quote'), ctx);

    const input = mockDynamo.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':pk']).toBe(`JOB#${USER_ID}#${JOB_ID_PADDED}`);
    expect(input.ExpressionAttributeValues[':prefix']).toBe('QUOTE');
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB down'));
    const res = await handler(makeEvent('GET', '/jobs/{jobId}/quote'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── PATCH /jobs/{jobId}/quote — editQuote ─────────────────────────────────────

describe('PATCH /jobs/{jobId}/quote — editQuote', () => {
  it('returns 200 with updated quote and recalculated totals', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })           // GetItem quote
      .mockResolvedValueOnce({ Items: [QUOTE_ITEM_1, QUOTE_ITEM_2] }) // Query old items
      .mockResolvedValueOnce({});                               // TransactWrite

    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.quote.totalAmount).toBe(700); // 10×25 + 10×45
    expect(body.quote.itemCount).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].lineTotal).toBe(250);
    expect(body.items[1].lineTotal).toBe(450);
  });

  it('assigns sequential seq numbers starting from 1', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);
    const body = JSON.parse(res.body);
    expect(body.items[0].seq).toBe(1);
    expect(body.items[1].seq).toBe(2);
  });

  it('deletes old items and inserts new ones in TransactWrite', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Items: [QUOTE_ITEM_1, QUOTE_ITEM_2] })
      .mockResolvedValueOnce({});

    await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const items = transactInput.TransactItems;
    const updates = items.filter((i: Record<string, unknown>) => 'Update' in i);
    const deletes = items.filter((i: Record<string, unknown>) => 'Delete' in i);
    const puts = items.filter((i: Record<string, unknown>) => 'Put' in i);
    expect(updates).toHaveLength(1); // quote header
    expect(deletes).toHaveLength(2); // old items
    expect(puts).toHaveLength(2);    // new items
  });

  it('returns 400 when items is missing', async () => {
    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', {}), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('items');
  });

  it('returns 400 when items array is empty', async () => {
    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', { items: [] }), ctx);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when item description is too short', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/quote', {
        items: [{ description: 'Hi', quantity: 1, unit: 'pz', unitPrice: 10 }],
      }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('items');
  });

  it('returns 400 when item quantity is zero or negative', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/quote', {
        items: [{ description: 'Lavori vari muratura', quantity: 0, unit: 'mq', unitPrice: 30 }],
      }), ctx);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when unitPrice is negative', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/quote', {
        items: [{ description: 'Lavori vari muratura', quantity: 1, unit: 'mq', unitPrice: -10 }],
      }), ctx);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when quote does not exist', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB failure'));
    const res = await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── POST /jobs/{jobId}/quote/approve — approveQuote ──────────────────────────

describe('POST /jobs/{jobId}/quote/approve — approveQuote', () => {
  it('returns 200, approves quote, and advances job to Accepted', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })  // GetItem quote
      .mockResolvedValueOnce({ Item: JOB_ITEM })       // GetItem job
      .mockResolvedValueOnce({});                      // TransactWrite

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('Approved');
    expect(body.totalAmount).toBe(2850);
    expect(body.jobAdvanced).toBe(true);
    expect(body.approvedAt).toBeDefined();
  });

  it('sets job status to Accepted with correct GSI1SK when job is in Quote status', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const jobUpdate = transactInput.TransactItems[1].Update;
    expect(jobUpdate.ExpressionAttributeValues[':accepted']).toBe('Accepted');
    expect(jobUpdate.ExpressionAttributeValues[':gsi1sk']).toBe(
      `JOB#Accepted#${JOB_ITEM.createdAt}`,
    );
  });

  it('does not advance job when already past Quote status', async () => {
    const acceptedJob = { ...JOB_ITEM, status: 'InProgress' };
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Item: acceptedJob })
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobAdvanced).toBe(false);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    expect(transactInput.TransactItems).toHaveLength(1); // only quote update
  });

  it('returns 400 when quote is already approved', async () => {
    const approvedQuote = { ...QUOTE_HEADER, status: 'Approved' };
    mockDynamo
      .mockResolvedValueOnce({ Item: approvedQuote })
      .mockResolvedValueOnce({ Item: JOB_ITEM });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when quote not found', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: JOB_ITEM });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when job not found', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB error'));
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/finalize'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── POST /jobs/{jobId}/quote/pdf — generateQuotePdf ──────────────────────────

describe('POST /jobs/{jobId}/quote/pdf — generateQuotePdf', () => {
  beforeEach(() => {
    mockPutObject.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/quote.pdf?signed=true');
  });

  it('returns 200 with presigned PDF URL', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [QUOTE_HEADER, QUOTE_ITEM_1, QUOTE_ITEM_2] }) // Query quote+items
      .mockResolvedValueOnce({ Item: JOB_ITEM })  // GetItem job
      .mockResolvedValueOnce({});                  // UpdateItem pdfS3Key

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/send'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pdfUrl).toBe('https://s3.example.com/quote.pdf?signed=true');
    expect(body.status).toBe('Draft');
    expect(body.totalAmount).toBe(2850);
  });

  it('uploads PDF to correct S3 key', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [QUOTE_HEADER, QUOTE_ITEM_1] })
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/send'), ctx);

    expect(mockPutObject).toHaveBeenCalledWith(
      'test-bucket',
      `users/${USER_ID}/jobs/${JOB_ID_PADDED}/quote.pdf`,
      expect.any(Buffer),
      'application/pdf',
    );
  });

  it('persists pdfS3Key on quote record after upload', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [QUOTE_HEADER, QUOTE_ITEM_1] })
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/send'), ctx);

    const updateInput = mockDynamo.mock.calls[2][0].input;
    expect(updateInput.ExpressionAttributeValues[':key']).toBe(
      `users/${USER_ID}/jobs/${JOB_ID_PADDED}/quote.pdf`,
    );
  });

  it('returns 404 when no quote exists', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: JOB_ITEM });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/send'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when job not found', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [QUOTE_HEADER] })
      .mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/send'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB failure'));
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/send'), ctx);
    expect(res.statusCode).toBe(500);
  });
});
