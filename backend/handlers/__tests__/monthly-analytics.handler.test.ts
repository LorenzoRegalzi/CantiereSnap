import { handler } from '../monthly-analytics.handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { docClient } from '../../shared/dynamodb';

const mockSend = docClient.send as jest.Mock;
const ctx = { awsRequestId: 'test-request-id' } as never;

afterEach(() => {
  jest.resetAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';

// Month window used in tests: we'll pin via Date mock so previousMonthWindow()
// returns a deterministic result. With today = 2026-05-01, previous month = 2026-04.
const PREV_MONTH = '2026-04';
const MONTH_START = '2026-04-01T00:00:00.000Z';
const MONTH_END_EXCLUSIVE = '2026-05-01T00:00:00.000Z';

const PROFILE_ITEM = { PK: `USER#${USER_ID}`, SK: 'PROFILE', email: 'test@example.com' };

// Job headers in the previous month
const JOB_COMPLETED = {
  SK: 'JOB#00001',
  status: 'Completed',
  createdAt: '2026-04-05T10:00:00.000Z',
  updatedAt: '2026-04-20T15:00:00.000Z',
};

const JOB_IN_PROGRESS = {
  SK: 'JOB#00002',
  status: 'InProgress',
  createdAt: '2026-04-10T08:00:00.000Z',
  updatedAt: '2026-04-10T08:00:00.000Z',
};

// Job outside the month window
const JOB_MARCH = {
  SK: 'JOB#00003',
  status: 'Completed',
  createdAt: '2026-03-15T10:00:00.000Z',
  updatedAt: '2026-03-28T10:00:00.000Z',
};

// Invoice for Job 1 (paid in April)
const INVOICE_PAID = {
  SK: 'INV#Paid#2026-04-22T00:00:00.000Z',
  GSI1SK: 'INV#Paid#2026-04-22T00:00:00.000Z',
  status: 'Paid',
  totalAmount: 1500.0,
  createdAt: '2026-04-22T00:00:00.000Z',
};

// Overdue invoice (status Overdue, any date)
const INVOICE_OVERDUE = {
  SK: 'INV#Overdue#2026-03-01T00:00:00.000Z',
  GSI1SK: 'INV#Overdue#2026-03-01T00:00:00.000Z',
  status: 'Overdue',
  totalAmount: 800.0,
  createdAt: '2026-03-01T00:00:00.000Z',
};

// Materials for Job 1
const MATERIAL_A = { SK: 'MATERIAL#AAA', cost: 120.0 };
const MATERIAL_B = { SK: 'MATERIAL#BBB', cost: 80.5 };

// Quote for Job 1
const QUOTE_ITEM = { SK: 'QUOTE', createdAt: '2026-04-06T10:00:00.000Z' };

// Invoice record in job partition for Job 1
const INVOICE_IN_JOB = {
  SK: 'INVOICE',
  createdAt: '2026-04-22T00:00:00.000Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('monthly-analytics handler', () => {
  beforeEach(() => {
    // Pin clock to 2026-05-01 so previousMonthWindow() deterministically returns 2026-04
    jest.useFakeTimers({ now: new Date('2026-05-01T01:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('processes zero users gracefully', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }); // Scan users

    await handler({ source: 'monthly-analytics' }, ctx);

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('saves analytics item for a user with jobs in the previous month', async () => {
    // Calls in order:
    // 1. Scan profiles
    // 2. Query job headers (USER#userId, JOB#)
    // 3. Query invoices via GSI1 (USER#userId, INV#)
    // 4. Query materials for job 00001 (JOB#userId#00001, MATERIAL#)
    // 5. Query quote for job 00001 (JOB#userId#00001, QUOTE)
    // 6. Query invoice for job 00001 (JOB#userId#00001, INVOICE)
    // 7. Query materials for job 00002 (JOB#userId#00002, MATERIAL#)
    // 8. Query quote for job 00002 (JOB#userId#00002, QUOTE)
    // 9. PutItem for analytics

    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM] }) // Scan
      .mockResolvedValueOnce({ Items: [JOB_COMPLETED, JOB_IN_PROGRESS, JOB_MARCH] }) // Jobs
      .mockResolvedValueOnce({ Items: [INVOICE_PAID, INVOICE_OVERDUE] }) // Invoices via GSI1
      .mockResolvedValueOnce({ Items: [MATERIAL_A, MATERIAL_B] }) // Materials job 1
      .mockResolvedValueOnce({ Items: [QUOTE_ITEM] }) // Quote job 1
      .mockResolvedValueOnce({ Items: [INVOICE_IN_JOB] }) // Invoice job 1
      .mockResolvedValueOnce({ Items: [] }) // Materials job 2
      .mockResolvedValueOnce({ Items: [] }) // Quote job 2
      .mockResolvedValueOnce({}); // PutItem analytics

    await handler({ source: 'monthly-analytics' }, ctx);

    const putCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    const item = putCall.input.Item;

    expect(item.PK).toBe(`USER#${USER_ID}`);
    expect(item.SK).toBe(`ANALYTICS#${PREV_MONTH}`);
    expect(item.entityType).toBe('MonthlyAnalytics');
    expect(item.month).toBe(PREV_MONTH);
    expect(item.jobsCreated).toBe(2); // only April jobs (JOB_MARCH excluded)
    expect(item.jobsCompleted).toBe(1); // only JOB_COMPLETED
    expect(item.completionRate).toBeCloseTo(0.5);
    expect(item.totalRevenue).toBe(1500.0);
    expect(item.invoicesPaid).toBe(1);
    expect(item.invoicesOverdue).toBe(1);
    expect(item.totalMaterialCost).toBeCloseTo(200.5);
    expect(item.aggregatedAt).toBeDefined();
  });

  it('calculates avgQuoteToInvoiceDays correctly', async () => {
    // Quote created 2026-04-06, Invoice created 2026-04-22 → 16 days
    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM] })
      .mockResolvedValueOnce({ Items: [JOB_COMPLETED] }) // 1 job in month
      .mockResolvedValueOnce({ Items: [INVOICE_PAID] }) // invoices
      .mockResolvedValueOnce({ Items: [] }) // materials
      .mockResolvedValueOnce({ Items: [QUOTE_ITEM] }) // quote created 2026-04-06
      .mockResolvedValueOnce({ Items: [INVOICE_IN_JOB] }) // invoice created 2026-04-22
      .mockResolvedValueOnce({}); // PutItem

    await handler({}, ctx);

    const putCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(putCall.input.Item.avgQuoteToInvoiceDays).toBe(16);
  });

  it('sets avgQuoteToInvoiceDays to 0 when no jobs have both quote and invoice', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM] })
      .mockResolvedValueOnce({ Items: [JOB_IN_PROGRESS] }) // no invoice
      .mockResolvedValueOnce({ Items: [] }) // no invoices via GSI1
      .mockResolvedValueOnce({ Items: [] }) // materials
      .mockResolvedValueOnce({ Items: [] }) // quote → not found
      .mockResolvedValueOnce({}); // PutItem

    await handler({}, ctx);

    const putCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(putCall.input.Item.avgQuoteToInvoiceDays).toBe(0);
  });

  it('excludes jobs created outside the previous month window', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM] })
      .mockResolvedValueOnce({ Items: [JOB_MARCH] }) // only March job
      .mockResolvedValueOnce({ Items: [] }) // no invoices
      .mockResolvedValueOnce({}); // PutItem

    await handler({}, ctx);

    const putCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(putCall.input.Item.jobsCreated).toBe(0);
    expect(putCall.input.Item.jobsCompleted).toBe(0);
    expect(putCall.input.Item.totalMaterialCost).toBe(0);
  });

  it('counts only Paid invoices from the previous month for revenue', async () => {
    const paidMay = {
      ...INVOICE_PAID,
      status: 'Paid',
      createdAt: '2026-05-01T10:00:00.000Z', // outside window
      totalAmount: 999.0,
    };
    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM] })
      .mockResolvedValueOnce({ Items: [] }) // no jobs in April
      .mockResolvedValueOnce({ Items: [INVOICE_PAID, paidMay] }) // 2 paid, 1 in April
      .mockResolvedValueOnce({}); // PutItem

    await handler({}, ctx);

    const putCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(putCall.input.Item.totalRevenue).toBe(1500.0); // only April invoice
    expect(putCall.input.Item.invoicesPaid).toBe(1);
  });

  it('handles multiple users independently', async () => {
    const profile2 = { PK: 'USER#user-2', SK: 'PROFILE' };

    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM, profile2] }) // Scan
      // User 1
      .mockResolvedValueOnce({ Items: [] }) // jobs
      .mockResolvedValueOnce({ Items: [] }) // invoices
      .mockResolvedValueOnce({}) // PutItem user 1
      // User 2
      .mockResolvedValueOnce({ Items: [] }) // jobs
      .mockResolvedValueOnce({ Items: [] }) // invoices
      .mockResolvedValueOnce({}); // PutItem user 2

    await handler({}, ctx);

    // Two PutItem calls (one per user)
    const putCalls = mockSend.mock.calls.filter((c) =>
      c[0]?.constructor?.name === 'PutCommand' ||
      c[0]?.input?.Item?.entityType === 'MonthlyAnalytics',
    );
    expect(putCalls).toHaveLength(2);
  });

  it('continues processing other users when one user fails', async () => {
    const profile2 = { PK: 'USER#user-2', SK: 'PROFILE' };

    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM, profile2] }) // Scan
      // User 1: job query throws
      .mockRejectedValueOnce(new Error('DynamoDB error'))
      // User 2: completes successfully
      .mockResolvedValueOnce({ Items: [] }) // jobs
      .mockResolvedValueOnce({ Items: [] }) // invoices
      .mockResolvedValueOnce({}); // PutItem user 2

    await expect(handler({}, ctx)).resolves.not.toThrow();

    // PutItem for user 2 was called
    const putCalls = mockSend.mock.calls.filter(
      (c) => c[0]?.input?.Item?.entityType === 'MonthlyAnalytics',
    );
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][0].input.Item.PK).toBe('USER#user-2');
  });

  it('paginates through multiple Scan pages for users', async () => {
    const sentinel = { PK: 'USER#boundary', SK: 'PROFILE' };
    const profile2 = { PK: 'USER#user-2', SK: 'PROFILE' };

    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM], LastEvaluatedKey: sentinel }) // page 1
      .mockResolvedValueOnce({ Items: [profile2], LastEvaluatedKey: undefined }) // page 2
      // User 1
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      // User 2
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await handler({}, ctx);

    // 2 scan pages + 2 users × (2 queries + 1 put) = 2 + 6 = 8
    expect(mockSend).toHaveBeenCalledTimes(8);
  });

  it('rounds monetary values to 2 decimal places', async () => {
    const mat1 = { SK: 'MATERIAL#X', cost: 10.1 };
    const mat2 = { SK: 'MATERIAL#Y', cost: 10.2 };

    mockSend
      .mockResolvedValueOnce({ Items: [PROFILE_ITEM] })
      .mockResolvedValueOnce({ Items: [JOB_COMPLETED] })
      .mockResolvedValueOnce({ Items: [] }) // no invoices
      .mockResolvedValueOnce({ Items: [mat1, mat2] }) // materials
      .mockResolvedValueOnce({ Items: [] }) // no quote
      .mockResolvedValueOnce({}); // PutItem

    await handler({}, ctx);

    const putCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(putCall.input.Item.totalMaterialCost).toBe(20.3);
  });
});
