import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { putObject, getPresignedUrl } from '../../shared/s3';
import { handler } from '../invoices.handler';

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/s3', () => ({
  putObject: jest.fn(),
  getPresignedUrl: jest.fn(),
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


const mockSend = docClient.send as jest.Mock;
const mockPutObject = putObject as jest.Mock;
const mockGetPresignedUrl = getPresignedUrl as jest.Mock;

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

const VALID_CREATE_BODY = {
  vatRate: 22,
  paymentTerms: '30 giorni data fattura',
  dueDate: '2099-12-31',
  notes: 'Lavori eseguiti presso Via Garibaldi 15, Carmagnola.',
};

const JOB_ITEM = {
  PK: 'USER#user-123',
  SK: 'JOB#00003',
  entityType: 'Job',
  jobId: 3,
  clientId: 'client-abc',
  clientName: 'Luigi Bianchi',
  status: 'Completed',
  createdAt: '2026-04-20T14:30:00.000Z',
  updatedAt: '2026-04-22T09:15:00.000Z',
};

const USER_PROFILE = {
  PK: 'USER#user-123',
  SK: 'PROFILE',
  entityType: 'UserProfile',
  fullName: 'Marco Rossi',
  businessName: 'Rossi Impianti',
  partitaIva: 'IT12345678901',
  codiceFiscale: 'RSSMRC85M01H501Z',
  regimeFiscale: 'RF19',
  address: { street: 'Via Roma 42', city: 'Carmagnola', province: 'TO', cap: '10022', country: 'IT' },
};

const CLIENT_ITEM = {
  PK: 'USER#user-123',
  SK: 'CLIENT#client-abc',
  entityType: 'Client',
  clientId: 'client-abc',
  clientName: 'Luigi Bianchi',
  email: 'luigi.bianchi@email.it',
  codiceFiscale: 'BNCLGU80A01H501Y',
  address: { street: 'Via Garibaldi 15', city: 'Carmagnola', province: 'TO', cap: '10022', country: 'IT' },
};

const QUOTE_META = {
  PK: 'JOB#user-123#00003',
  SK: 'QUOTE',
  entityType: 'Quote',
  totalAmount: 2850,
  currency: 'EUR',
  status: 'Approved',
  createdAt: '2026-04-20T15:00:00.000Z',
};

const QUOTE_LINE_ITEM = {
  PK: 'JOB#user-123#00003',
  SK: 'QUOTE#ITEM#001',
  entityType: 'QuoteItem',
  seq: 1,
  description: 'Rimozione impianto idraulico esistente in rame',
  quantity: 1,
  unit: 'intervento',
  unitPrice: 350,
  lineTotal: 350,
};

const INVOICE_ITEM = {
  PK: 'JOB#user-123#00003',
  SK: 'INVOICE',
  GSI1PK: 'USER#user-123',
  GSI1SK: 'INV#Draft#2026-05-12T10:00:00.000Z',
  GSI2PK: 'INV_STATUS#Draft',
  GSI2SK: '2099-12-31',
  entityType: 'Invoice',
  invoiceNumber: '2026/003',
  userId: 'user-123',
  jobId: '00003',
  clientName: 'Luigi Bianchi',
  clientEmail: 'luigi.bianchi@email.it',
  totalAmount: 427,
  vatAmount: 77,
  vatRate: 22,
  currency: 'EUR',
  status: 'Draft',
  dueDate: '2099-12-31',
  xmlS3Key: 'users/user-123/jobs/00003/fattura_2026_003.xml',
  paymentTerms: '30 giorni data fattura',
  createdAt: '2026-05-12T10:00:00.000Z',
  updatedAt: '2026-05-12T10:00:00.000Z',
};

const INVOICE_LINE_ITEM = {
  PK: 'JOB#user-123#00003',
  SK: 'INVOICE#ITEM#001',
  entityType: 'InvoiceItem',
  seq: 1,
  description: 'Rimozione impianto idraulico esistente in rame',
  quantity: 1,
  unit: 'intervento',
  unitPrice: 350,
  lineTotal: 350,
};

// Helper that sets up all mocks for a successful createInvoice flow
function setupCreateMocks() {
  mockSend
    .mockResolvedValueOnce({ Item: JOB_ITEM })           // GetItem job
    .mockResolvedValueOnce({ Item: USER_PROFILE })        // GetItem profile
    .mockResolvedValueOnce({ Item: CLIENT_ITEM })         // GetItem client
    .mockResolvedValueOnce({ Item: undefined })           // GetItem invoice check (none)
    .mockResolvedValueOnce({ Items: [QUOTE_META, QUOTE_LINE_ITEM] }) // Query quote
    .mockResolvedValueOnce({ Attributes: { lastInvoiceId: 3 } })     // UpdateItem counter
    .mockResolvedValueOnce({});                           // TransactWrite
  mockPutObject.mockResolvedValueOnce(undefined);
  mockGetPresignedUrl.mockResolvedValueOnce('https://mock-s3-url.com/fattura.xml');
}

// ── POST /jobs/{jobId}/invoice — createInvoice ────────────────────────────────

describe('POST /jobs/{jobId}/invoice — createInvoice', () => {
  it('creates invoice and returns 201 with correct shape', async () => {
    setupCreateMocks();

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.invoiceNumber).toMatch(/^\d{4}\/\d{3}$/);
    expect(body.jobId).toBe(3);
    expect(body.clientName).toBe('Luigi Bianchi');
    expect(body.vatRate).toBe(22);
    expect(body.currency).toBe('EUR');
    expect(body.status).toBe('Draft');
    expect(body.dueDate).toBe('2099-12-31');
    expect(body.xmlUrl).toBe('https://mock-s3-url.com/fattura.xml');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].description).toBe('Rimozione impianto idraulico esistente in rame');
  });

  it('computes vatAmount and totalAmount correctly', async () => {
    setupCreateMocks();

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);

    const body = JSON.parse(res.body);
    // quote lineTotal = 350; vatRate = 22%
    expect(body.vatAmount).toBe(77);
    expect(body.totalAmount).toBe(427);
  });

  it('uploads XML to S3 with correct key pattern', async () => {
    setupCreateMocks();

    await handler(makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);

    expect(mockPutObject).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringMatching(/^users\/user-123\/jobs\/00003\/fattura_\d{4}_\d{3}\.xml$/),
      expect.stringContaining('FatturaElettronica'),
      'application/xml',
    );
  });

  it('returns 400 for invalid vatRate', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, { ...VALID_CREATE_BODY, vatRate: 15 }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('vatRate');
  });

  it('returns 400 when paymentTerms is too short', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, { ...VALID_CREATE_BODY, paymentTerms: 'ok' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('paymentTerms');
  });

  it('returns 400 when dueDate is missing', async () => {
    const { dueDate: _omit, ...withoutDate } = VALID_CREATE_BODY;
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, withoutDate), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('dueDate');
  });

  it('returns 400 when dueDate is in the past', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, { ...VALID_CREATE_BODY, dueDate: '2000-01-01' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('dueDate');
  });

  it('returns 404 when job does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '99' }, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 (INVALID_STATUS_TRANSITION) when job is not Completed', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...JOB_ITEM, status: 'InProgress' } });

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 400 when user profile is missing fiscal data', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: { ...USER_PROFILE, partitaIva: undefined } });

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 when invoice already exists', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: USER_PROFILE })
      .mockResolvedValueOnce({ Item: CLIENT_ITEM })
      .mockResolvedValueOnce({ Item: INVOICE_ITEM }); // existing invoice

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('returns 400 when job has no quote', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({ Item: USER_PROFILE })
      .mockResolvedValueOnce({ Item: CLIENT_ITEM })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] }); // no quote

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 when DynamoDB throws unexpectedly', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/invoice', { jobId: '3' }, VALID_CREATE_BODY), ctx);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /jobs/{jobId}/invoice — getInvoice ────────────────────────────────────

describe('GET /jobs/{jobId}/invoice — getInvoice', () => {
  it('returns invoice with items and fresh xmlUrl', async () => {
    mockSend.mockResolvedValueOnce({ Items: [INVOICE_ITEM, INVOICE_LINE_ITEM] });
    mockGetPresignedUrl.mockResolvedValueOnce('https://mock-s3-url.com/fattura.xml');

    const res = await handler(
      makeEvent('GET', '/jobs/{jobId}/invoice', { jobId: '3' }), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invoiceNumber).toBe('2026/003');
    expect(body.jobId).toBe(3);
    expect(body.status).toBe('Draft');
    expect(body.xmlUrl).toBe('https://mock-s3-url.com/fattura.xml');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].seq).toBe(1);
  });

  it('returns 404 when invoice does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const res = await handler(
      makeEvent('GET', '/jobs/{jobId}/invoice', { jobId: '99' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('sorts invoice items by seq', async () => {
    const item2 = { ...INVOICE_LINE_ITEM, SK: 'INVOICE#ITEM#002', seq: 2, description: 'Secondo articolo' };
    mockSend.mockResolvedValueOnce({ Items: [INVOICE_ITEM, item2, INVOICE_LINE_ITEM] });
    mockGetPresignedUrl.mockResolvedValueOnce('https://mock-s3-url.com/fattura.xml');

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/invoice', { jobId: '3' }), ctx);

    const body = JSON.parse(res.body);
    expect(body.items[0].seq).toBe(1);
    expect(body.items[1].seq).toBe(2);
  });
});

// ── PATCH /jobs/{jobId}/invoice/status — updateInvoiceStatus ─────────────────

describe('PATCH /jobs/{jobId}/invoice/status — updateInvoiceStatus', () => {
  it('transitions Draft → Sent and returns correct shape', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: INVOICE_ITEM })  // GetItem current invoice
      .mockResolvedValueOnce({});                     // UpdateItem

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Sent' }), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invoiceNumber).toBe('2026/003');
    expect(body.previousStatus).toBe('Draft');
    expect(body.newStatus).toBe('Sent');
    expect(body.updatedAt).toBeDefined();
    expect(body.paidAt).toBeUndefined();
  });

  it('transitions Sent → Paid and records paidAt', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...INVOICE_ITEM, status: 'Sent' } })
      .mockResolvedValueOnce({});

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Paid' }), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.newStatus).toBe('Paid');
    expect(body.paidAt).toBeDefined();
  });

  it('transitions Overdue → Paid', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { ...INVOICE_ITEM, status: 'Overdue' } })
      .mockResolvedValueOnce({});

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Paid' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).newStatus).toBe('Paid');
  });

  it('verifies UpdateItem uses ExpressionAttributeNames for status', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: INVOICE_ITEM })
      .mockResolvedValueOnce({});

    await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Sent' }), ctx);

    const updateInput = mockSend.mock.calls[1][0].input;
    expect(updateInput.ExpressionAttributeNames).toHaveProperty('#invStatus');
    expect(updateInput.ExpressionAttributeValues[':newStatus']).toBe('Sent');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Cancelled' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('status');
  });

  it('returns 400 for invalid transition (Draft → Paid)', async () => {
    mockSend.mockResolvedValueOnce({ Item: INVOICE_ITEM }); // status = Draft

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Paid' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 400 for invalid transition (Paid → any)', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...INVOICE_ITEM, status: 'Paid' } });

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '3' }, { status: 'Sent' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('returns 404 when invoice does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(
      makeEvent('PATCH', '/jobs/{jobId}/invoice/status', { jobId: '99' }, { status: 'Sent' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /invoices — listInvoices ──────────────────────────────────────────────

describe('GET /invoices — listInvoices', () => {
  it('lists all invoices for the user', async () => {
    mockSend.mockResolvedValueOnce({ Items: [INVOICE_ITEM], LastEvaluatedKey: undefined });

    const res = await handler(makeEvent('GET', '/invoices'), ctx);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].invoiceNumber).toBe('2026/003');
    expect(body.nextToken).toBeNull();
  });

  it('queries GSI-1 with INV# prefix when no status filter', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/invoices'), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('StatusIndex');
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('INV#');
  });

  it('queries with status-specific prefix when status filter is provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [INVOICE_ITEM] });

    await handler(makeEvent('GET', '/invoices', null, null, { status: 'Draft' }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('INV#Draft#');
  });

  it('returns nextToken when more pages exist', async () => {
    const lastKey = { GSI1PK: 'USER#user-123', GSI1SK: 'INV#Draft#2026-05-12T10:00:00.000Z' };
    mockSend.mockResolvedValueOnce({ Items: [INVOICE_ITEM], LastEvaluatedKey: lastKey });

    const res = await handler(makeEvent('GET', '/invoices'), ctx);
    expect(JSON.parse(res.body).nextToken).not.toBeNull();
  });

  it('decodes nextToken into ExclusiveStartKey', async () => {
    const lastKey = { GSI1PK: 'USER#user-123', GSI1SK: 'INV#Draft#2026-05-12T10:00:00.000Z' };
    const token = Buffer.from(JSON.stringify(lastKey)).toString('base64');
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await handler(makeEvent('GET', '/invoices', null, null, { nextToken: token }), ctx);

    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.ExclusiveStartKey).toEqual(lastKey);
  });

  it('returns 400 for an invalid status filter', async () => {
    const res = await handler(
      makeEvent('GET', '/invoices', null, null, { status: 'Unknown' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('status');
  });

  it('returns only summary fields (no items array, no xmlUrl)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [INVOICE_ITEM] });

    const res = await handler(makeEvent('GET', '/invoices'), ctx);
    const item = JSON.parse(res.body).items[0];
    expect(item.items).toBeUndefined();
    expect(item.xmlUrl).toBeUndefined();
    expect(item.clientName).toBe('Luigi Bianchi');
  });
});
