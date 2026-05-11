import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { handler } from '../notifications.handler';

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOTIFY_ITEM_EMAIL = {
  PK: 'USER#user-123',
  SK: 'NOTIFY#2026-06-04T08:00:00.000Z',
  entityType: 'NotificationLog',
  type: 'InvoiceReminder',
  channel: 'email',
  recipientEmail: 'luigi.bianchi@email.it',
  invoiceNumber: '2026/003',
  jobId: '00003',
  status: 'Sent',
  createdAt: '2026-06-04T08:00:00.000Z',
};

const NOTIFY_ITEM_SMS = {
  PK: 'USER#user-123',
  SK: 'NOTIFY#2026-03-16T09:00:00.000Z',
  entityType: 'NotificationLog',
  type: 'SmsReminder',
  channel: 'sms',
  recipientPhone: '+393339876543',
  jobId: '00001',
  status: 'Sent',
  createdAt: '2026-03-16T09:00:00.000Z',
};

const PREFERENCES_ITEM = {
  PK: 'USER#user-123',
  SK: 'PREFERENCES',
  emailEnabled: true,
  smsEnabled: false,
  updatedAt: '2026-05-06T10:00:00.000Z',
};

// ── GET /notifications — listNotifications ────────────────────────────────────

describe('GET /notifications — listNotifications', () => {
  it('returns notification list with correct shape', async () => {
    mockSend.mockResolvedValueOnce({ Items: [NOTIFY_ITEM_EMAIL, NOTIFY_ITEM_SMS], LastEvaluatedKey: undefined });

    const res = await handler(makeEvent('GET', '/notifications'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
    expect(body.nextToken).toBeNull();
  });

  it('maps email notification fields correctly', async () => {
    mockSend.mockResolvedValueOnce({ Items: [NOTIFY_ITEM_EMAIL] });

    const res = await handler(makeEvent('GET', '/notifications'), ctx);

    const item = JSON.parse(res.body).items[0];
    expect(item.type).toBe('InvoiceReminder');
    expect(item.channel).toBe('email');
    expect(item.recipientEmail).toBe('luigi.bianchi@email.it');
    expect(item.recipientPhone).toBeNull();
    expect(item.invoiceNumber).toBe('2026/003');
    expect(item.jobId).toBe('00003');
    expect(item.status).toBe('Sent');
    expect(item.createdAt).toBe('2026-06-04T08:00:00.000Z');
  });

  it('maps SMS notification fields correctly (no email, no invoiceNumber)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [NOTIFY_ITEM_SMS] });

    const res = await handler(makeEvent('GET', '/notifications'), ctx);

    const item = JSON.parse(res.body).items[0];
    expect(item.type).toBe('SmsReminder');
    expect(item.channel).toBe('sms');
    expect(item.recipientPhone).toBe('+393339876543');
    expect(item.recipientEmail).toBeNull();
    expect(item.invoiceNumber).toBeNull();
  });

  it('returns empty items array when no notifications exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/notifications'), ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(0);
  });

  it('queries with NOTIFY# prefix and ScanIndexForward=false', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/notifications'), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('NOTIFY#');
    expect(queryInput.ScanIndexForward).toBe(false);
  });

  it('caps limit at 50', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/notifications', null, null, { limit: '999' }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.Limit).toBe(50);
  });

  it('returns nextToken when more pages exist', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'NOTIFY#2026-03-16T09:00:00.000Z' };
    mockSend.mockResolvedValueOnce({ Items: [NOTIFY_ITEM_EMAIL], LastEvaluatedKey: lastKey });

    const res = await handler(makeEvent('GET', '/notifications'), ctx);

    expect(JSON.parse(res.body).nextToken).not.toBeNull();
  });

  it('decodes nextToken into ExclusiveStartKey', async () => {
    const lastKey = { PK: 'USER#user-123', SK: 'NOTIFY#2026-03-16T09:00:00.000Z' };
    const token = Buffer.from(JSON.stringify(lastKey)).toString('base64');
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await handler(makeEvent('GET', '/notifications', null, null, { nextToken: token }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExclusiveStartKey).toEqual(lastKey);
  });

  it('returns 500 when DynamoDB throws unexpectedly', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(makeEvent('GET', '/notifications'), ctx);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });
});

// ── PATCH /notifications/preferences — updatePreferences ─────────────────────

describe('PATCH /notifications/preferences — updatePreferences', () => {
  it('updates both emailEnabled and smsEnabled', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: PREFERENCES_ITEM });

    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { emailEnabled: true, smsEnabled: false }), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.emailEnabled).toBe(true);
    expect(body.smsEnabled).toBe(false);
    expect(body.updatedAt).toBeDefined();
  });

  it('updates only emailEnabled', async () => {
    mockSend.mockResolvedValueOnce({
      Attributes: { ...PREFERENCES_ITEM, emailEnabled: false },
    });

    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { emailEnabled: false }), ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).emailEnabled).toBe(false);
  });

  it('updates only smsEnabled', async () => {
    mockSend.mockResolvedValueOnce({
      Attributes: { ...PREFERENCES_ITEM, smsEnabled: true },
    });

    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { smsEnabled: true }), ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).smsEnabled).toBe(true);
  });

  it('writes to PREFERENCES sort key', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: PREFERENCES_ITEM });

    await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { emailEnabled: true }), ctx);

    const updateInput = mockSend.mock.calls[0][0].input;
    expect(updateInput.Key.SK).toBe('PREFERENCES');
    expect(updateInput.Key.PK).toBe('USER#user-123');
  });

  it('returns 400 when no preference fields are provided', async () => {
    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, {}), ctx);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when emailEnabled is not a boolean', async () => {
    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { emailEnabled: 'yes' }), ctx);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('emailEnabled');
  });

  it('returns 400 when smsEnabled is not a boolean', async () => {
    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { smsEnabled: 1 }), ctx);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('smsEnabled');
  });

  it('returns 500 when DynamoDB throws unexpectedly', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(
      makeEvent('PATCH', '/notifications/preferences', null, { emailEnabled: true }), ctx);

    expect(res.statusCode).toBe(500);
  });
});
