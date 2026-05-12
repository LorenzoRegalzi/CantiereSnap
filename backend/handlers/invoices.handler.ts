import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger } from '../shared/logger';
import { GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { putObject, getPresignedUrl } from '../shared/s3';
import { buildFatturaPA } from '../shared/fatturapa';
import { ok, created, badRequest, notFound, conflict, internalError } from '../shared/response';

const TABLE = process.env.TABLE_NAME!;
const BUCKET = process.env.BUCKET_NAME!;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Address {
  street: string;
  city: string;
  province: string;
  cap: string;
  country: string;
}

interface InvoiceItem {
  seq: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

const VALID_VAT_RATES = new Set([0, 4, 5, 10, 22]);
const VALID_STATUSES = new Set(['Draft', 'Sent', 'Paid', 'Overdue']);
const STATUS_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Sent'],
  Sent: ['Paid', 'Overdue'],
  Overdue: ['Paid'],
  Paid: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.claims?.sub as string;
}

function parseBody<T>(event: APIGatewayProxyEvent): T {
  try {
    return JSON.parse(event.body ?? '{}') as T;
  } catch {
    return {} as T;
  }
}

function padJobId(n: number): string {
  return String(n).padStart(5, '0');
}

function encodeToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeToken(token: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function toInvoiceSummary(item: Record<string, unknown>) {
  return {
    invoiceNumber: item.invoiceNumber,
    jobId: item.jobId,
    clientName: item.clientName,
    totalAmount: item.totalAmount,
    vatAmount: item.vatAmount,
    status: item.status,
    dueDate: item.dueDate,
    createdAt: item.createdAt,
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function createInvoice(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{
    vatRate?: unknown;
    paymentTerms?: string;
    dueDate?: string;
    notes?: string;
  }>(event);

  // Validate vatRate
  const vatRate = Number(body.vatRate);
  if (!VALID_VAT_RATES.has(vatRate))
    return badRequest('VALIDATION_ERROR', 'vatRate must be one of: 0, 4, 5, 10, 22.', 'vatRate');

  // Validate paymentTerms
  const paymentTerms = body.paymentTerms?.trim() ?? '';
  if (paymentTerms.length < 5 || paymentTerms.length > 200)
    return badRequest(
      'VALIDATION_ERROR',
      'paymentTerms is required (5–200 characters).',
      'paymentTerms',
    );

  // Validate dueDate
  const dueDate = body.dueDate ?? '';
  const today = new Date().toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today)
    return badRequest(
      'VALIDATION_ERROR',
      'dueDate must be a valid ISO 8601 date not earlier than today.',
      'dueDate',
    );

  // Validate notes
  if (body.notes !== undefined && body.notes.length > 2000)
    return badRequest('VALIDATION_ERROR', 'notes must not exceed 2000 characters.', 'notes');

  // Fetch job header
  const jobResult = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` } }),
  );
  if (!jobResult.Item) return notFound('Job not found.');
  const job = jobResult.Item as Record<string, unknown>;
  if (job.status !== 'Completed')
    return badRequest(
      'INVALID_STATUS_TRANSITION',
      'An invoice can only be generated for jobs in Completed status.',
    );

  // Fetch user profile
  const profileResult = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }),
  );
  const profile = profileResult.Item as Record<string, unknown> | undefined;
  if (!profile?.partitaIva || !profile?.codiceFiscale || !profile?.regimeFiscale)
    return badRequest(
      'VALIDATION_ERROR',
      'Incomplete profile: partitaIva, codiceFiscale and regimeFiscale are required to generate an invoice.',
    );

  // Fetch client
  const clientResult = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `CLIENT#${job.clientId}` },
    }),
  );
  const client = clientResult.Item as Record<string, unknown> | undefined;
  if (!client) return notFound('Client associated with this job not found.');

  // Check no existing invoice
  const existingInvoice = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'INVOICE' },
    }),
  );
  if (existingInvoice.Item) return conflict('An invoice already exists for this job.');

  // Fetch quote + quote items
  const quoteResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${userId}#${jobIdFormatted}`,
        ':prefix': 'QUOTE',
      },
    }),
  );
  const quoteItems = (quoteResult.Items ?? []) as Record<string, unknown>[];
  const quoteMeta = quoteItems.find((i) => i.SK === 'QUOTE');
  const lineItems = quoteItems
    .filter((i) => (i.SK as string).startsWith('QUOTE#ITEM#'))
    .sort((a, b) => ((a.seq as number) ?? 0) - ((b.seq as number) ?? 0)) as Record<string, unknown>[];

  if (!quoteMeta) return badRequest('VALIDATION_ERROR', 'No quote found for this job.');
  if (lineItems.length === 0) return badRequest('VALIDATION_ERROR', 'The quote has no line items.');

  // Increment invoice counter
  const year = new Date().getFullYear();
  const counterResult = await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `COUNTER#INV#${year}` },
      UpdateExpression: 'ADD lastInvoiceId :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const seq = (counterResult.Attributes?.lastInvoiceId as number) ?? 1;
  const invoiceNumber = `${year}/${String(seq).padStart(3, '0')}`;
  const xmlFileName = `fattura_${year}_${String(seq).padStart(3, '0')}.xml`;
  const xmlS3Key = `users/${userId}/jobs/${jobIdFormatted}/${xmlFileName}`;

  // Compute totals
  const imponibile = lineItems.reduce((sum, i) => sum + (i.lineTotal as number), 0);
  const vatAmount = Math.round(imponibile * vatRate) / 100;
  const totalAmount = Math.round((imponibile + vatAmount) * 100) / 100;

  const now = new Date().toISOString();
  const invoiceDate = now.split('T')[0];

  // Build and upload FatturaPA XML
  const partitaIvaCode = (profile.partitaIva as string).replace(/^IT/, '');
  const xmlContent = buildFatturaPA({
    invoiceNumber,
    invoiceDate,
    dueDate,
    paymentTerms,
    notes: body.notes,
    cedente: {
      partitaIvaCode,
      codiceFiscale: profile.codiceFiscale as string,
      name: (profile.businessName ?? profile.fullName) as string,
      regimeFiscale: profile.regimeFiscale as string,
      address: profile.address as Address,
    },
    cessionario: {
      codiceFiscale: client.codiceFiscale as string,
      name: client.clientName as string,
      address: client.address as Address,
    },
    items: lineItems.map((i) => ({
      seq: i.seq as number,
      description: i.description as string,
      quantity: i.quantity as number,
      unit: i.unit as string,
      unitPrice: i.unitPrice as number,
      lineTotal: i.lineTotal as number,
    })),
    imponibile,
    vatRate,
    vatAmount,
    totalAmount,
  });

  await putObject(BUCKET, xmlS3Key, xmlContent, 'application/xml');

  // Atomic write: job → Invoiced, invoice header, status history, invoice items
  const invoiceItemPuts = lineItems.map((i) => ({
    Put: {
      TableName: TABLE,
      Item: {
        PK: `JOB#${userId}#${jobIdFormatted}`,
        SK: `INVOICE#ITEM#${String(i.seq as number).padStart(3, '0')}`,
        entityType: 'InvoiceItem',
        seq: i.seq,
        description: i.description,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      },
    },
  }));

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` },
            UpdateExpression: 'SET #jobStatus = :invoiced, GSI1SK = :gsi1sk, updatedAt = :now',
            ExpressionAttributeNames: { '#jobStatus': 'status' },
            ExpressionAttributeValues: {
              ':invoiced': 'Invoiced',
              ':gsi1sk': `JOB#Invoiced#${job.createdAt as string}`,
              ':now': now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `JOB#${userId}#${jobIdFormatted}`,
              SK: 'INVOICE',
              GSI1PK: `USER#${userId}`,
              GSI1SK: `INV#Draft#${now}`,
              GSI2PK: 'INV_STATUS#Draft',
              GSI2SK: dueDate,
              entityType: 'Invoice',
              invoiceNumber,
              userId,
              jobId: jobIdFormatted,
              clientName: job.clientName,
              clientEmail: client.email,
              totalAmount,
              vatAmount,
              vatRate,
              currency: 'EUR',
              status: 'Draft',
              dueDate,
              xmlS3Key,
              paymentTerms,
              ...(body.notes ? { notes: body.notes } : {}),
              createdAt: now,
              updatedAt: now,
            },
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `JOB#${userId}#${jobIdFormatted}`,
              SK: `STATUS#${now}`,
              entityType: 'StatusTransition',
              fromStatus: 'Completed',
              toStatus: 'Invoiced',
              changedAt: now,
            },
          },
        },
        ...invoiceItemPuts,
      ],
    }),
  );

  const xmlUrl = await getPresignedUrl(BUCKET, xmlS3Key);

  const invoiceLineItems: InvoiceItem[] = lineItems.map((i) => ({
    seq: i.seq as number,
    description: i.description as string,
    quantity: i.quantity as number,
    unit: i.unit as string,
    unitPrice: i.unitPrice as number,
    lineTotal: i.lineTotal as number,
  }));

  return created({
    invoiceNumber,
    jobId: numId,
    clientName: job.clientName,
    totalAmount,
    vatAmount,
    vatRate,
    currency: 'EUR',
    status: 'Draft',
    dueDate,
    paymentTerms,
    xmlUrl,
    createdAt: now,
    items: invoiceLineItems,
  });
}

async function getInvoice(userId: string, jobIdRaw: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${userId}#${jobIdFormatted}`,
        ':prefix': 'INVOICE',
      },
    }),
  );

  const items = (result.Items ?? []) as Record<string, unknown>[];
  const header = items.find((i) => i.SK === 'INVOICE');
  if (!header) return notFound('Invoice not found for this job.');

  const lineItems = items
    .filter((i) => (i.SK as string).startsWith('INVOICE#ITEM#'))
    .sort((a, b) => ((a.seq as number) ?? 0) - ((b.seq as number) ?? 0));

  const xmlUrl = await getPresignedUrl(BUCKET, header.xmlS3Key as string);

  return ok({
    invoiceNumber: header.invoiceNumber,
    jobId: numId,
    clientName: header.clientName,
    totalAmount: header.totalAmount,
    vatAmount: header.vatAmount,
    vatRate: header.vatRate,
    currency: header.currency,
    status: header.status,
    dueDate: header.dueDate,
    paymentTerms: header.paymentTerms,
    xmlUrl,
    createdAt: header.createdAt,
    items: lineItems.map((i) => ({
      seq: i.seq,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
  });
}

async function updateInvoiceStatus(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{ status?: string }>(event);
  const newStatus = body.status;

  if (!newStatus || !VALID_STATUSES.has(newStatus))
    return badRequest(
      'VALIDATION_ERROR',
      'status must be one of: Sent, Paid, Overdue.',
      'status',
    );

  // Fetch current invoice
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'INVOICE' },
    }),
  );
  if (!result.Item) return notFound('Invoice not found.');

  const invoice = result.Item as Record<string, unknown>;
  const currentStatus = invoice.status as string;

  if (!STATUS_TRANSITIONS[currentStatus]?.includes(newStatus))
    return badRequest(
      'INVALID_STATUS_TRANSITION',
      `Invalid transition: ${currentStatus} → ${newStatus}.`,
    );

  const now = new Date().toISOString();
  const setClauses = [
    '#invStatus = :newStatus',
    'GSI1SK = :gsi1sk',
    'GSI2PK = :gsi2pk',
    'updatedAt = :now',
  ];
  const exprValues: Record<string, unknown> = {
    ':newStatus': newStatus,
    ':gsi1sk': `INV#${newStatus}#${invoice.createdAt as string}`,
    ':gsi2pk': `INV_STATUS#${newStatus}`,
    ':now': now,
  };

  if (newStatus === 'Paid') {
    setClauses.push('paidAt = :now');
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'INVOICE' },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: { '#invStatus': 'status' },
      ExpressionAttributeValues: exprValues,
    }),
  );

  return ok({
    invoiceNumber: invoice.invoiceNumber,
    previousStatus: currentStatus,
    newStatus,
    updatedAt: now,
    ...(newStatus === 'Paid' ? { paidAt: now } : {}),
  });
}

async function listInvoices(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const status = qs.status;
  const limit = Math.min(parseInt(qs.limit ?? '20', 10) || 20, 100);
  const exclusiveStartKey = qs.nextToken ? decodeToken(qs.nextToken) : undefined;

  if (status !== undefined && !VALID_STATUSES.has(status))
    return badRequest('VALIDATION_ERROR', 'status must be one of: Draft, Sent, Paid, Overdue.', 'status');

  const skPrefix = status ? `INV#${status}#` : 'INV#';

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':prefix': skPrefix,
      },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
      ScanIndexForward: false,
    }),
  );

  const items = (result.Items ?? []) as Record<string, unknown>[];
  const lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;

  return ok({
    items: items.map(toInvoiceSummary),
    nextToken: lastKey ? encodeToken(lastKey) : null,
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('invoices', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;
  const jobId = event.pathParameters?.jobId ?? '';

  try {
    if (resource === '/jobs/{jobId}/invoice') {
      if (method === 'POST') return await createInvoice(event, userId, jobId);
      if (method === 'GET') return await getInvoice(userId, jobId);
    }
    if (resource === '/jobs/{jobId}/invoice/status') {
      if (method === 'PATCH') return await updateInvoiceStatus(event, userId, jobId);
    }
    if (resource === '/invoices') {
      if (method === 'GET') return await listInvoices(event, userId);
    }
    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
