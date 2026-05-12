import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { handler } from '../dashboard.handler';

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


const mockDynamo = docClient.send as jest.Mock;

// ── Test helpers ──────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';

const makeEvent = (
  method: string,
  resource: string,
  qs: Record<string, string> | null = null,
): APIGatewayProxyEvent =>
  ({
    httpMethod: method,
    resource,
    path: resource,
    pathParameters: null,
    queryStringParameters: qs,
    body: null,
    requestContext: { authorizer: { claims: { sub: USER_ID } } },
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  }) as unknown as APIGatewayProxyEvent;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOBS = [
  { status: 'Quote', GSI1SK: 'JOB#Quote#2026-04-01T00:00:00.000Z' },
  { status: 'InProgress', GSI1SK: 'JOB#InProgress#2026-03-15T00:00:00.000Z' },
  { status: 'Completed', GSI1SK: 'JOB#Completed#2026-02-01T00:00:00.000Z' },
  {
    status: 'Invoiced',
    GSI1SK: 'JOB#Invoiced#2026-01-01T00:00:00.000Z',
    quoteCreatedAt: '2026-01-05T00:00:00.000Z',
    invoiceCreatedAt: '2026-01-15T00:00:00.000Z',
  },
  { status: 'Cancelled', GSI1SK: 'JOB#Cancelled#2026-01-20T00:00:00.000Z' },
];

const PAID_INVOICES = [
  { totalAmount: 1200, createdAt: '2026-05-03T10:00:00.000Z' },
  { totalAmount: 800, createdAt: '2026-05-04T14:00:00.000Z' },
];

const OVERDUE_INVOICES = [
  { totalAmount: 500, dueDate: '2026-04-30' },
  { totalAmount: 300, dueDate: '2026-04-15' },
];

// ── GET /dashboard/summary ────────────────────────────────────────────────────

describe('GET /dashboard/summary — getSummary', () => {
  it('returns 200 with all summary fields', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: JOBS })
      .mockResolvedValueOnce({ Items: PAID_INVOICES })
      .mockResolvedValueOnce({ Items: OVERDUE_INVOICES });

    const res = await handler(makeEvent('GET', '/dashboard/summary'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.monthlyRevenue).toBe(2000);
    expect(body.overdueInvoices).toBe(2);
    expect(body.totalJobs).toBe(5);
    expect(body.completedJobs).toBe(2);
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body).toHaveProperty('completionRate');
    expect(body).toHaveProperty('avgQuoteToInvoiceDays');
  });

  it('computes completionRate excluding Cancelled jobs', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: JOBS })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/summary'), ctx);
    const body = JSON.parse(res.body);
    // 4 non-cancelled, 2 completed/invoiced → 50%
    expect(body.completionRate).toBe(50);
  });

  it('computes avgQuoteToInvoiceDays from invoiced jobs with timestamps', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: JOBS })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/summary'), ctx);
    const body = JSON.parse(res.body);
    // invoiceCreatedAt - quoteCreatedAt = 10 days
    expect(body.avgQuoteToInvoiceDays).toBe(10);
  });

  it('returns null avgQuoteToInvoiceDays when no invoiced jobs have timestamps', async () => {
    const jobsNoTimestamps = JOBS.map(({ quoteCreatedAt: _q, invoiceCreatedAt: _i, ...rest }) => rest);
    mockDynamo
      .mockResolvedValueOnce({ Items: jobsNoTimestamps })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/summary'), ctx);
    const body = JSON.parse(res.body);
    expect(body.avgQuoteToInvoiceDays).toBeNull();
  });

  it('returns zero metrics when user has no data', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/summary'), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.monthlyRevenue).toBe(0);
    expect(body.completionRate).toBe(0);
    expect(body.overdueInvoices).toBe(0);
    expect(body.avgQuoteToInvoiceDays).toBeNull();
    expect(body.totalJobs).toBe(0);
    expect(body.completedJobs).toBe(0);
  });

  it('queries StatusIndex with correct key expressions for jobs', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/dashboard/summary'), ctx);

    const jobsInput = mockDynamo.mock.calls[0][0].input;
    expect(jobsInput.IndexName).toBe('StatusIndex');
    expect(jobsInput.ExpressionAttributeValues[':pk']).toBe(`USER#${USER_ID}`);
    expect(jobsInput.ExpressionAttributeValues[':prefix']).toBe('JOB#');
  });

  it('queries overdue invoices with INV#Overdue# prefix', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/dashboard/summary'), ctx);

    const overdueInput = mockDynamo.mock.calls[2][0].input;
    expect(overdueInput.ExpressionAttributeValues[':prefix']).toBe('INV#Overdue#');
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await handler(makeEvent('GET', '/dashboard/summary'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /dashboard/revenue ────────────────────────────────────────────────────

describe('GET /dashboard/revenue — getRevenue', () => {
  const INVOICES_MULTI_MONTH = [
    { totalAmount: 1200, createdAt: '2026-03-15T10:00:00.000Z' },
    { totalAmount: 800, createdAt: '2026-04-02T10:00:00.000Z' },
    { totalAmount: 600, createdAt: '2026-04-20T10:00:00.000Z' },
    { totalAmount: 2000, createdAt: '2026-05-03T10:00:00.000Z' },
  ];

  it('returns revenue grouped by month with totals', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: INVOICES_MULTI_MONTH });

    const res = await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: '2026-03-01', endDate: '2026-05-31' }), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.startDate).toBe('2026-03-01');
    expect(body.endDate).toBe('2026-05-31');
    expect(body.months).toHaveLength(3);

    const march = body.months.find((m: { month: string }) => m.month === '2026-03');
    const april = body.months.find((m: { month: string }) => m.month === '2026-04');
    const may = body.months.find((m: { month: string }) => m.month === '2026-05');
    expect(march.revenue).toBe(1200);
    expect(april.revenue).toBe(1400);
    expect(may.revenue).toBe(2000);
    expect(body.total).toBe(4600);
  });

  it('fills months with zero revenue when no invoices in range', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    const res = await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: '2026-01-01', endDate: '2026-03-31' }), ctx);

    const body = JSON.parse(res.body);
    expect(body.months).toHaveLength(3);
    body.months.forEach((m: { revenue: number }) => expect(m.revenue).toBe(0));
    expect(body.total).toBe(0);
  });

  it('uses BETWEEN condition with correct GSI1SK range', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: '2026-01-01', endDate: '2026-03-31' }), ctx);

    const input = mockDynamo.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StatusIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe(`USER#${USER_ID}`);
    expect(input.ExpressionAttributeValues[':start']).toBe('INV#Paid#2026-01-01');
    expect(input.ExpressionAttributeValues[':end']).toBe('INV#Paid#2026-03-31T23:59:59.999Z');
  });

  it('returns 400 for invalid startDate format', async () => {
    const res = await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: 'not-a-date', endDate: '2026-05-31' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid endDate format', async () => {
    const res = await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: '2026-01-01', endDate: '31-05-2026' }), ctx);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when startDate is after endDate', async () => {
    const res = await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: '2026-06-01', endDate: '2026-05-01' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('uses default last 12 months when no dates provided', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/revenue'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.months).toHaveLength(12);
  });

  it('handles a single-month range correctly', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [{ totalAmount: 500, createdAt: '2026-05-10T00:00:00.000Z' }] });

    const res = await handler(
      makeEvent('GET', '/dashboard/revenue', { startDate: '2026-05-01', endDate: '2026-05-31' }), ctx);

    const body = JSON.parse(res.body);
    expect(body.months).toHaveLength(1);
    expect(body.months[0].month).toBe('2026-05');
    expect(body.months[0].revenue).toBe(500);
    expect(body.total).toBe(500);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB down'));

    const res = await handler(makeEvent('GET', '/dashboard/revenue'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /dashboard/jobs-stats ─────────────────────────────────────────────────

describe('GET /dashboard/jobs-stats — getJobsStats', () => {
  it('returns counts for all statuses', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: JOBS });

    const res = await handler(makeEvent('GET', '/dashboard/jobs-stats'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(5);
    expect(body.byStatus.Quote).toBe(1);
    expect(body.byStatus.Accepted).toBe(0);
    expect(body.byStatus.InProgress).toBe(1);
    expect(body.byStatus.Completed).toBe(1);
    expect(body.byStatus.Invoiced).toBe(1);
    expect(body.byStatus.Cancelled).toBe(1);
  });

  it('returns all-zero counts when user has no jobs', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/jobs-stats'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(0);
    Object.values(body.byStatus as Record<string, number>).forEach((v) => expect(v).toBe(0));
  });

  it('includes all six status keys in response', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/dashboard/jobs-stats'), ctx);
    const body = JSON.parse(res.body);
    expect(Object.keys(body.byStatus)).toEqual(
      expect.arrayContaining(['Quote', 'Accepted', 'InProgress', 'Completed', 'Invoiced', 'Cancelled']),
    );
  });

  it('queries StatusIndex for all jobs with JOB# prefix', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/dashboard/jobs-stats'), ctx);

    const input = mockDynamo.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StatusIndex');
    expect(input.ExpressionAttributeValues[':pk']).toBe(`USER#${USER_ID}`);
    expect(input.ExpressionAttributeValues[':prefix']).toBe('JOB#');
  });

  it('counts multiple jobs with the same status correctly', async () => {
    const manyJobs = [
      { status: 'InProgress' },
      { status: 'InProgress' },
      { status: 'InProgress' },
      { status: 'Completed' },
    ];
    mockDynamo.mockResolvedValueOnce({ Items: manyJobs });

    const res = await handler(makeEvent('GET', '/dashboard/jobs-stats'), ctx);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(4);
    expect(body.byStatus.InProgress).toBe(3);
    expect(body.byStatus.Completed).toBe(1);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('Connection failed'));

    const res = await handler(makeEvent('GET', '/dashboard/jobs-stats'), ctx);
    expect(res.statusCode).toBe(500);
  });
});
