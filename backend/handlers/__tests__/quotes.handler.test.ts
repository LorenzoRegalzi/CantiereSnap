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

// Lambda client mock — factory must NOT reference variables declared in this
// file because jest.mock() is hoisted above all declarations.
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  InvokeCommand: jest.fn().mockImplementation((input) => input),
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

// ── POST /jobs/{jobId}/quote/generate — async dispatch (API path) ─────────────
// The API handler now returns 202 immediately and fires a Lambda self-invocation.
// The background Lambda does the actual Claude call (tested separately below).

describe('POST /jobs/{jobId}/quote/generate — async API path', () => {
  it('returns 202 and writes processing placeholder — Claude NOT called synchronously', async () => {
    // Verifies the async dispatch pattern: API path returns immediately without calling
    // Claude. The background Lambda (separate async invocation) handles the AI call.
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })  // GetItem job
      .mockResolvedValueOnce({ Item: undefined })  // GetItem quote (not found)
      .mockResolvedValueOnce({});                  // PutItem processing placeholder

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).status).toBe('processing');
    // DynamoDB: 2 GetItems + 1 PutItem (placeholder) = 3 calls total
    expect(mockDynamo).toHaveBeenCalledTimes(3);
    expect(mockAnthropic).not.toHaveBeenCalled();
  });

  it('writes processing placeholder with correct shape', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    const putInput = mockDynamo.mock.calls[2][0].input;
    expect(putInput.Item.PK).toBe(`JOB#${USER_ID}#${JOB_ID_PADDED}`);
    expect(putInput.Item.SK).toBe('QUOTE');
    expect(putInput.Item.entityType).toBe('Quote');
    expect(putInput.Item.status).toBe('processing');
    expect(putInput.Item.inputLength).toBe(VALID_DESCRIPTION.length);
    expect(putInput.ConditionExpression).toContain('attribute_not_exists');
  });

  it('returns 202 (idempotent) when quote is already processing — no second invocation', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: { ...QUOTE_HEADER, status: 'processing' } });

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);

    expect(res.statusCode).toBe(202);
    // Only 2 GetItem calls — no PutItem and no Lambda invoke
    expect(mockDynamo).toHaveBeenCalledTimes(2);
    expect(mockAnthropic).not.toHaveBeenCalled();
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

  it('returns 409 when a non-processing quote already exists', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: QUOTE_HEADER }); // status: 'Draft'

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('returns 500 on unexpected DynamoDB error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB down'));

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/quote/generate', { description: VALID_DESCRIPTION }), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── Background Lambda (async-quote-generation event) ──────────────────────────
// Invoked asynchronously by the API path. Tests verify Claude is called correctly
// and the quote is written to DynamoDB (or marked failed on error).

const makeBackgroundEvent = (description = VALID_DESCRIPTION, notes?: string) => ({
  source: 'async-quote-generation' as const,
  userId: USER_ID,
  jobIdFormatted: JOB_ID_PADDED,
  description,
  notes,
});

describe('Background Lambda — runBackgroundGeneration', () => {
  it('calls Claude with correct model and token limits, then writes quote via TransactWrite', async () => {
    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });
    mockDynamo.mockResolvedValueOnce({}); // TransactWrite

    await handler(makeBackgroundEvent() as never, ctx);

    const aiCall = mockAnthropic.mock.calls[0][0];
    expect(aiCall.model).toBe('claude-sonnet-4-6');
    expect(aiCall.max_tokens).toBe(4096); // background Lambda uses higher limit to avoid mid-JSON truncation
    expect(aiCall.system).toContain('Italian');
    expect(aiCall.messages[0].role).toBe('user');
    expect(aiCall.messages[0].content).toContain(VALID_DESCRIPTION);

    const transactInput = mockDynamo.mock.calls[0][0].input;
    const update = transactInput.TransactItems[0].Update;
    expect(update.Key.SK).toBe('QUOTE');
    expect(update.ExpressionAttributeValues[':draft']).toBe('Draft');
  });

  it('includes optional notes in the AI prompt', async () => {
    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeBackgroundEvent(VALID_DESCRIPTION, 'Usare piastrelle Marazzi') as never, ctx);

    const aiCall = mockAnthropic.mock.calls[0][0];
    expect(aiCall.messages[0].content).toContain('Usare piastrelle Marazzi');
  });

  it('stores line items with correct SK format', async () => {
    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: AI_ITEMS_JSON }],
    });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeBackgroundEvent() as never, ctx);

    const transactInput = mockDynamo.mock.calls[0][0].input;
    const item1Put = transactInput.TransactItems[1].Put.Item;
    expect(item1Put.SK).toBe('QUOTE#ITEM#001');
    expect(item1Put.entityType).toBe('QuoteItem');
    const item2Put = transactInput.TransactItems[2].Put.Item;
    expect(item2Put.SK).toBe('QUOTE#ITEM#002');
  });

  it('recalculates lineTotal server-side (ignores AI value)', async () => {
    const wrongTotal = JSON.stringify([
      { seq: 1, description: 'Lavori idraulici', quantity: 2, unit: 'ore', unitPrice: 50, lineTotal: 999 },
    ]);
    mockAnthropic.mockResolvedValueOnce({ content: [{ type: 'text', text: wrongTotal }] });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeBackgroundEvent() as never, ctx);

    const transactInput = mockDynamo.mock.calls[0][0].input;
    const item = transactInput.TransactItems[1].Put.Item;
    expect(item.lineTotal).toBe(100); // 2 × 50, not 999
  });

  it('parses JSON embedded in surrounding text', async () => {
    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: `Here is the quote:\n${AI_ITEMS_JSON}\nEnd of quote.` }],
    });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeBackgroundEvent() as never, ctx);

    const transactInput = mockDynamo.mock.calls[0][0].input;
    expect(transactInput.TransactItems).toHaveLength(3); // 1 Update + 2 Puts
  });

  it('marks quote as failed when Anthropic API throws', async () => {
    mockAnthropic.mockRejectedValueOnce(new Error('Connection timeout'));
    mockDynamo.mockResolvedValueOnce({}); // UpdateCommand setting status = 'failed'

    await handler(makeBackgroundEvent() as never, ctx);

    const updateInput = mockDynamo.mock.calls[0][0].input;
    expect(updateInput.ExpressionAttributeValues[':failed']).toBe('failed');
  });

  it('marks quote as failed when AI returns invalid JSON', async () => {
    mockAnthropic.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }],
    });
    mockDynamo.mockResolvedValueOnce({}); // UpdateCommand setting status = 'failed'

    await handler(makeBackgroundEvent() as never, ctx);

    const updateInput = mockDynamo.mock.calls[0][0].input;
    expect(updateInput.ExpressionAttributeValues[':failed']).toBe('failed');
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

  it('deletes old items that have no matching new SK, inserts new items in TransactWrite', async () => {
    // Bug fix: before the fix, Delete+Put on the same SK within one TransactWrite caused
    // a DynamoDB collision error. The fix skips Delete for any SK that a Put will also write.
    // Old items use seq 3 and 4 (SKs 003, 004); new items use seq 1 and 2 (SKs 001, 002).
    // No overlap → 2 deletes + 2 puts generated correctly.
    const OLD_ITEM_3 = { ...QUOTE_ITEM_1, SK: 'QUOTE#ITEM#003', seq: 3 };
    const OLD_ITEM_4 = { ...QUOTE_ITEM_2, SK: 'QUOTE#ITEM#004', seq: 4 };

    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Items: [OLD_ITEM_3, OLD_ITEM_4] })
      .mockResolvedValueOnce({});

    await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const items = transactInput.TransactItems;
    const updates = items.filter((i: Record<string, unknown>) => 'Update' in i);
    const deletes = items.filter((i: Record<string, unknown>) => 'Delete' in i);
    const puts = items.filter((i: Record<string, unknown>) => 'Put' in i);
    expect(updates).toHaveLength(1); // quote header
    expect(deletes).toHaveLength(2); // old items (non-overlapping SKs)
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

// ── Bug regression tests ──────────────────────────────────────────────────────

describe('Regression: TransactWrite Delete+Put same-key collision in editQuote', () => {
  it('does NOT include a Delete for a SK that a Put will also write in the same transaction', async () => {
    // Bug: editQuote deleted ALL existing items then inserted new ones. When the new item
    // count equalled the old count, DynamoDB rejected the transaction because you cannot
    // Delete and Put the same SK in a single TransactWriteItems call.
    // Fix: only Delete items whose SK is absent from the incoming Put set.
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Items: [QUOTE_ITEM_1, QUOTE_ITEM_2] }) // old: seq 1, 2
      .mockResolvedValueOnce({});

    // New items also use seq 1, 2 → same SKs as old → zero deletes expected
    await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const deletes = transactInput.TransactItems.filter((i: Record<string, unknown>) => 'Delete' in i);
    expect(deletes).toHaveLength(0);
  });

  it('only deletes items whose SK is absent from the incoming items', async () => {
    // Old items: seq 1, 2, 3. New items: seq 1, 2. Only seq 3 should be deleted.
    const OLD_ITEM_3 = { ...QUOTE_ITEM_1, SK: 'QUOTE#ITEM#003', seq: 3 };
    mockDynamo
      .mockResolvedValueOnce({ Item: QUOTE_HEADER })
      .mockResolvedValueOnce({ Items: [QUOTE_ITEM_1, QUOTE_ITEM_2, OLD_ITEM_3] })
      .mockResolvedValueOnce({});

    await handler(makeEvent('PATCH', '/jobs/{jobId}/quote', VALID_ITEMS_BODY), ctx);

    const transactInput = mockDynamo.mock.calls[2][0].input;
    const deletes = transactInput.TransactItems.filter((i: Record<string, unknown>) => 'Delete' in i);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].Delete.Key.SK).toBe('QUOTE#ITEM#003');
  });
});
