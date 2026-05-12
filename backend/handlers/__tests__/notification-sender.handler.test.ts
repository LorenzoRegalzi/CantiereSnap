import { handler } from '../notification-sender.handler';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/ses', () => ({
  sendEmail: jest.fn(),
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { docClient } from '../../shared/dynamodb';
import { sendEmail } from '../../shared/ses';

const mockSend = docClient.send as jest.Mock;
const mockSendEmail = sendEmail as jest.Mock;

beforeEach(() => {
  mockSendEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.resetAllMocks();
});

const ctx = { awsRequestId: 'test-request-id' } as never;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INVOICE_A: Record<string, unknown> = {
  userId: 'user-1',
  jobId: '1',
  clientName: 'Bianchi S.r.l.',
  clientEmail: 'bianchi@example.com',
  invoiceNumber: '2026/001',
  totalAmount: 3500.0,
  GSI2SK: '2026-04-15',
};

const INVOICE_B: Record<string, unknown> = {
  userId: 'user-2',
  jobId: '2',
  clientName: 'Verdi Giuseppe',
  clientEmail: 'verdi@example.com',
  invoiceNumber: '2026/002',
  totalAmount: 1200.5,
  GSI2SK: '2026-04-20',
};

// ── overdue-alert ─────────────────────────────────────────────────────────────

describe('overdue-alert', () => {
  const event = { source: 'overdue-alert' };

  it('queries DueDateIndex for Overdue invoices and sends emails', async () => {
    // GSI query → 2 invoices; PutCommand for each log entry
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A, INVOICE_B], LastEvaluatedKey: undefined })
      .mockResolvedValueOnce({}) // logNotification A
      .mockResolvedValueOnce({}); // logNotification B

    await handler(event, ctx);

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);

    // First email is to Invoice A's client
    expect(mockSendEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: 'bianchi@example.com',
        subject: expect.stringContaining('2026/001'),
      }),
    );
  });

  it('logs notification with status Sent when email succeeds', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A] })
      .mockResolvedValueOnce({});

    await handler(event, ctx);

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item.status).toBe('Sent');
    expect(putCall.input.Item.type).toBe('OverdueAlert');
    expect(putCall.input.Item.PK).toBe(`USER#${INVOICE_A.userId}`);
    expect(putCall.input.Item.SK).toMatch(/^NOTIFY#/);
    expect(putCall.input.Item.ttl).toBeGreaterThan(0);
  });

  it('logs notification with status Failed when email throws', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SES error'));
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A] })
      .mockResolvedValueOnce({});

    await handler(event, ctx);

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item.status).toBe('Failed');
  });

  it('continues processing remaining invoices when one email fails', async () => {
    mockSendEmail
      .mockRejectedValueOnce(new Error('SES error'))
      .mockResolvedValueOnce(undefined);

    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A, INVOICE_B] })
      .mockResolvedValueOnce({}) // log A
      .mockResolvedValueOnce({}); // log B

    await handler(event, ctx);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('handles empty result set gracefully', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(event, ctx);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('paginates through multiple pages of GSI results', async () => {
    const sentinelKey = { GSI2PK: 'INV_STATUS#Overdue', GSI2SK: '2026-04-14' };
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A], LastEvaluatedKey: sentinelKey }) // page 1
      .mockResolvedValueOnce({ Items: [INVOICE_B], LastEvaluatedKey: undefined }) // page 2
      .mockResolvedValueOnce({}) // log A
      .mockResolvedValueOnce({}); // log B

    await handler(event, ctx);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    // 2 GSI pages + 2 PutCommands
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('continues processing other invoices if log write fails', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A, INVOICE_B] })
      .mockRejectedValueOnce(new Error('DynamoDB error')) // log A fails
      .mockResolvedValueOnce({}); // log B succeeds

    await expect(handler(event, ctx)).resolves.not.toThrow();
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });
});

// ── invoice-reminder ──────────────────────────────────────────────────────────

describe('invoice-reminder', () => {
  const event = { source: 'invoice-reminder' };

  it('queries DueDateIndex for Sent invoices due within 7 days', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A] })
      .mockResolvedValueOnce({});

    await handler(event, ctx);

    expect(mockSend).toHaveBeenCalledTimes(2);
    // Verify the GSI query used INV_STATUS#Sent
    const queryCall = mockSend.mock.calls[0][0];
    expect(queryCall.input.ExpressionAttributeValues[':pk']).toBe('INV_STATUS#Sent');
  });

  it('sends reminder emails to clients', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A, INVOICE_B] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(event, ctx);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'bianchi@example.com',
        subject: expect.stringContaining('2026/001'),
      }),
    );
  });

  it('logs InvoiceReminder type notifications', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A] })
      .mockResolvedValueOnce({});

    await handler(event, ctx);

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item.type).toBe('InvoiceReminder');
    expect(putCall.input.Item.channel).toBe('email');
  });

  it('handles empty result set gracefully', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(event, ctx);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('continues processing remaining invoices when one fails', async () => {
    mockSendEmail
      .mockRejectedValueOnce(new Error('SES error'))
      .mockResolvedValueOnce(undefined);

    mockSend
      .mockResolvedValueOnce({ Items: [INVOICE_A, INVOICE_B] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(event, ctx);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });
});

// ── Unknown source ────────────────────────────────────────────────────────────

describe('Unknown event source', () => {
  it('does not throw and makes no DB or email calls for unknown source', async () => {
    await expect(handler({ source: 'unknown-event' }, ctx)).resolves.not.toThrow();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
