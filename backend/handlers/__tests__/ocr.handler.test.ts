import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../ocr.handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/textract', () => ({
  textractClient: { send: jest.fn() },
}));

jest.mock('../../shared/s3', () => ({
  getPresignedUrl: jest.fn(),
}));

jest.mock('../../shared/anthropic', () => ({
  anthropicClient: {
    messages: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


import { docClient } from '../../shared/dynamodb';
import { textractClient } from '../../shared/textract';
import { getPresignedUrl } from '../../shared/s3';
import { anthropicClient } from '../../shared/anthropic';

const mockSend = docClient.send as jest.Mock;
const mockTextract = textractClient.send as jest.Mock;
const mockPresignedUrl = getPresignedUrl as jest.Mock;
const mockCreate = anthropicClient.messages.create as jest.Mock;

// Reset all mock implementations between tests to prevent state leakage.
// clearMocks (in jest.config) only clears call history; resetAllMocks also
// removes implementations so each test starts from a clean slate.
beforeEach(() => {
  mockPresignedUrl.mockResolvedValue('https://s3.example.com/signed-url');
});

afterEach(() => {
  jest.resetAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';
const JOB_ID = '3';
const MATERIAL_ID = 'MAT001ABC';
const S3_KEY = `users/${USER_ID}/jobs/00003/receipts/scan.jpg`;

function makeEvent(
  overrides: Partial<{
    resource: string;
    httpMethod: string;
    pathParameters: Record<string, string>;
    body: string | null;
  }> = {},
): APIGatewayProxyEvent {
  return {
    resource: '/jobs/{jobId}/materials',
    httpMethod: 'GET',
    pathParameters: { jobId: JOB_ID },
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: `/jobs/${JOB_ID}/materials`,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: { sub: USER_ID } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  } as APIGatewayProxyEvent;
}

const SAMPLE_MATERIAL = {
  materialId: MATERIAL_ID,
  itemName: 'Cemento 25kg',
  quantity: 4,
  cost: 28.0,
  confidence: 95,
  sourceS3Key: S3_KEY,
  verified: false,
  createdAt: '2026-05-07T10:00:00.000Z',
};

const TEXTRACT_BLOCKS = [
  { BlockType: 'LINE', Text: 'Cemento 25kg x4 EUR 28.00' },
  { BlockType: 'LINE', Text: 'Sabbia fina 50kg x2 EUR 15.00' },
];

const CLAUDE_TWO_ITEMS = JSON.stringify([
  { itemName: 'Cemento 25kg', quantity: 4, cost: 28.0 },
  { itemName: 'Sabbia fina 50kg', quantity: 2, cost: 15.0 },
]);

// ── POST /jobs/{jobId}/materials/scan ─────────────────────────────────────────

describe('POST /jobs/{jobId}/materials/scan', () => {
  const scanEvent = (body: object | null = { s3Key: S3_KEY }) =>
    makeEvent({
      resource: '/jobs/{jobId}/materials/scan',
      httpMethod: 'POST',
      body: body === null ? null : JSON.stringify(body),
    });

  it('returns 400 when s3Key is missing', async () => {
    const res = await handler(scanEvent({}), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('s3Key');
  });

  it('returns 400 when s3Key belongs to another user', async () => {
    const res = await handler(scanEvent({ s3Key: 'users/other-user/jobs/00003/receipts/x.jpg' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('s3Key');
  });

  it('returns 404 when job does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null });
    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with extracted items on success', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } }) // GetJob
      .mockResolvedValueOnce({}) // PutCommand item 1
      .mockResolvedValueOnce({}); // PutCommand item 2
    mockTextract.mockResolvedValueOnce({ Blocks: TEXTRACT_BLOCKS });
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: CLAUDE_TWO_ITEMS }] });

    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].itemName).toBe('Cemento 25kg');
    expect(body.items[0].verified).toBe(false);
    expect(body.items[0].confidence).toBe(95);
    expect(body.sourceImageUrl).toBe('https://s3.example.com/signed-url');
  });

  it('adds warning to items with lowConfidence flag from Claude', async () => {
    const lowConfResponse = JSON.stringify([
      { itemName: 'Raccordo 20mm', quantity: 3, cost: 9.0, lowConfidence: true },
    ]);
    mockSend
      .mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } })
      .mockResolvedValueOnce({});
    mockTextract.mockResolvedValueOnce({ Blocks: TEXTRACT_BLOCKS });
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: lowConfResponse }] });

    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items[0].confidence).toBe(70);
    expect(body.items[0].warning).toBeDefined();
    expect(body.items[0].verified).toBe(false);
  });

  it('returns 200 with empty items when Textract returns no text', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } });
    mockTextract.mockResolvedValueOnce({ Blocks: [] });

    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(0);
  });

  it('returns 502 when Textract fails', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } });
    mockTextract.mockRejectedValueOnce(new Error('Textract timeout'));

    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('returns 502 when Claude parsing fails', async () => {
    mockSend.mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } });
    mockTextract.mockResolvedValueOnce({ Blocks: TEXTRACT_BLOCKS });
    mockCreate.mockRejectedValueOnce(new Error('Claude error'));

    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });

  it('handles Claude returning JSON wrapped in prose', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } })
      .mockResolvedValueOnce({});
    mockTextract.mockResolvedValueOnce({ Blocks: TEXTRACT_BLOCKS });
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'Here are the items:\n[{"itemName":"Tubo 20mm","quantity":5,"cost":25.00}]\nDone.',
        },
      ],
    });

    const res = await handler(scanEvent(), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items[0].itemName).toBe('Tubo 20mm');
  });

  it('returns 404 for non-numeric jobId', async () => {
    const res = await handler(
      makeEvent({
        resource: '/jobs/{jobId}/materials/scan',
        httpMethod: 'POST',
        pathParameters: { jobId: 'abc' },
        body: JSON.stringify({ s3Key: S3_KEY }),
      }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /jobs/{jobId}/materials ───────────────────────────────────────────────

describe('GET /jobs/{jobId}/materials', () => {
  it('returns 200 with items and totalCost', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { ...SAMPLE_MATERIAL, cost: 28.0 },
        { ...SAMPLE_MATERIAL, materialId: 'MAT002', cost: 15.0 },
      ],
    });

    const res = await handler(makeEvent(), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
    expect(body.totalCost).toBe(43.0);
  });

  it('returns 200 with empty list when no materials', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent(), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(0);
    expect(body.totalCost).toBe(0);
  });

  it('includes warning for items with confidence < 80', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...SAMPLE_MATERIAL, confidence: 72 }],
    });
    const res = await handler(makeEvent(), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items[0].warning).toBeDefined();
  });

  it('does not include warning for items with confidence >= 80', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...SAMPLE_MATERIAL, confidence: 95 }],
    });
    const res = await handler(makeEvent(), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items[0].warning).toBeUndefined();
  });

  it('returns 404 for non-numeric jobId', async () => {
    const res = await handler(makeEvent({ pathParameters: { jobId: 'abc' } }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('calculates totalCost with floating-point safety', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { ...SAMPLE_MATERIAL, cost: 10.1 },
        { ...SAMPLE_MATERIAL, cost: 10.2 },
      ],
    });
    const res = await handler(makeEvent(), ctx);
    expect(JSON.parse(res.body).totalCost).toBe(20.3);
  });
});

// ── POST /jobs/{jobId}/materials ──────────────────────────────────────────────

describe('POST /jobs/{jobId}/materials', () => {
  const addEvent = (body: object) =>
    makeEvent({ httpMethod: 'POST', body: JSON.stringify(body) });

  const validBody = { itemName: 'Silicone sanitario', quantity: 3, cost: 18.0 };

  it('returns 201 with confidence 100 and verified true', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } })
      .mockResolvedValueOnce({});

    const res = await handler(addEvent(validBody), ctx);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.confidence).toBe(100);
    expect(body.verified).toBe(true);
    expect(body.itemName).toBe('Silicone sanitario');
    expect(body.quantity).toBe(3);
    expect(body.cost).toBe(18.0);
    expect(body.materialId).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('trims whitespace from itemName', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } })
      .mockResolvedValueOnce({});

    const res = await handler(addEvent({ ...validBody, itemName: '  Cemento  ' }), ctx);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).itemName).toBe('Cemento');
  });

  it('returns 400 when itemName is missing', async () => {
    const res = await handler(addEvent({ quantity: 3, cost: 18.0 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('itemName');
  });

  it('returns 400 when itemName is too short', async () => {
    const res = await handler(addEvent({ ...validBody, itemName: 'X' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('itemName');
  });

  it('returns 400 when itemName exceeds 200 chars', async () => {
    const res = await handler(addEvent({ ...validBody, itemName: 'A'.repeat(201) }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('itemName');
  });

  it('returns 400 when quantity is zero', async () => {
    const res = await handler(addEvent({ ...validBody, quantity: 0 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('quantity');
  });

  it('returns 400 when quantity is negative', async () => {
    const res = await handler(addEvent({ ...validBody, quantity: -1 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('quantity');
  });

  it('returns 400 when cost is negative', async () => {
    const res = await handler(addEvent({ ...validBody, cost: -5 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('cost');
  });

  it('accepts cost of 0', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { PK: `USER#${USER_ID}` } })
      .mockResolvedValueOnce({});

    const res = await handler(addEvent({ ...validBody, cost: 0 }), ctx);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).cost).toBe(0);
  });

  it('returns 404 when job does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null });
    const res = await handler(addEvent(validBody), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-numeric jobId', async () => {
    const res = await handler(
      makeEvent({
        httpMethod: 'POST',
        pathParameters: { jobId: 'xyz' },
        body: JSON.stringify(validBody),
      }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── PUT /jobs/{jobId}/materials/{materialId} ──────────────────────────────────

describe('PUT /jobs/{jobId}/materials/{materialId}', () => {
  const updateEvent = (body: object) =>
    makeEvent({
      resource: '/jobs/{jobId}/materials/{materialId}',
      httpMethod: 'PUT',
      pathParameters: { jobId: JOB_ID, materialId: MATERIAL_ID },
      body: JSON.stringify(body),
    });

  it('returns 200 and sets verified to true', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } })
      .mockResolvedValueOnce({});

    const res = await handler(updateEvent({ itemName: 'Cemento aggiornato' }), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.verified).toBe(true);
    expect(body.itemName).toBe('Cemento aggiornato');
  });

  it('preserves unchanged fields from existing item', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } })
      .mockResolvedValueOnce({});

    const res = await handler(updateEvent({ cost: 35.0 }), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.cost).toBe(35.0);
    expect(body.quantity).toBe(SAMPLE_MATERIAL.quantity);
    expect(body.itemName).toBe(SAMPLE_MATERIAL.itemName);
  });

  it('returns 404 when material does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null });
    const res = await handler(updateEvent({ quantity: 2 }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid itemName on update', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } });
    const res = await handler(updateEvent({ itemName: 'X' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('itemName');
  });

  it('returns 400 for invalid quantity on update', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } });
    const res = await handler(updateEvent({ quantity: -3 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('quantity');
  });

  it('returns 400 for invalid cost on update', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } });
    const res = await handler(updateEvent({ cost: -10 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('cost');
  });

  it('trims itemName on update', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } })
      .mockResolvedValueOnce({});

    const res = await handler(updateEvent({ itemName: '  Tubo 20mm  ' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).itemName).toBe('Tubo 20mm');
  });

  it('returns 404 for non-numeric jobId', async () => {
    const res = await handler(
      makeEvent({
        resource: '/jobs/{jobId}/materials/{materialId}',
        httpMethod: 'PUT',
        pathParameters: { jobId: 'abc', materialId: MATERIAL_ID },
        body: JSON.stringify({ quantity: 2 }),
      }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE /jobs/{jobId}/materials/{materialId} ───────────────────────────────

describe('DELETE /jobs/{jobId}/materials/{materialId}', () => {
  const deleteEvent = () =>
    makeEvent({
      resource: '/jobs/{jobId}/materials/{materialId}',
      httpMethod: 'DELETE',
      pathParameters: { jobId: JOB_ID, materialId: MATERIAL_ID },
      body: null,
    });

  it('returns 204 on successful delete', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } })
      .mockResolvedValueOnce({});

    const res = await handler(deleteEvent(), ctx);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('returns 404 when material does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null });
    const res = await handler(deleteEvent(), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for non-numeric jobId', async () => {
    const res = await handler(
      makeEvent({
        resource: '/jobs/{jobId}/materials/{materialId}',
        httpMethod: 'DELETE',
        pathParameters: { jobId: 'abc', materialId: MATERIAL_ID },
        body: null,
      }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('soft-deletes: calls UpdateCommand with deletedAt', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...SAMPLE_MATERIAL } })
      .mockResolvedValueOnce({});

    await handler(deleteEvent(), ctx);

    const secondCall = mockSend.mock.calls[1][0];
    expect(secondCall.input.UpdateExpression).toContain('deletedAt');
  });
});

// ── Unknown routes ────────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for unknown resource', async () => {
    const res = await handler(
      makeEvent({ resource: '/jobs/{jobId}/unknown', httpMethod: 'GET' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});
