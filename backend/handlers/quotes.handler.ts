import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, type Logger } from '../shared/logger';
import { GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import PDFDocument from 'pdfkit';
import { docClient } from '../shared/dynamodb';
import { putObject, getPresignedUrl } from '../shared/s3';
import { anthropicClient } from '../shared/anthropic';
import {
  ok,
  created,
  badRequest,
  notFound,
  conflict,
  badGateway,
  internalError,
} from '../shared/response';

const TABLE = process.env.TABLE_NAME!;
const BUCKET = process.env.BUCKET_NAME!;
const QUOTE_MODEL = 'claude-sonnet-4-6';
const MAX_ITEMS = 30;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawItem {
  seq?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
}

interface LineItem {
  seq: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

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

function padSeq(n: number): string {
  return String(n).padStart(3, '0');
}

// ── AI prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional Italian construction estimator (Geometra/Impresario edile).
Generate a detailed, itemised quote for construction work in Italy.

Return ONLY a valid JSON array of line items with this exact schema, no other text:
[
  {
    "seq": 1,
    "description": "Description in Italian",
    "quantity": 2.5,
    "unit": "mq",
    "unitPrice": 45.00,
    "lineTotal": 112.50
  }
]

Rules:
- Use realistic Italian construction pricing in EUR
- Include both labour (manodopera) and materials (materiali) items where appropriate
- Use standard Italian construction units: mq, ml, pz, ore, corpo, intervento, kg
- lineTotal must equal quantity × unitPrice rounded to 2 decimal places
- Return 3–15 line items appropriate for the work described
- All descriptions must be in Italian
- Do NOT include VAT in prices`;

function buildUserMessage(description: string, notes?: string): string {
  let msg = `Descrizione lavori: ${description}`;
  if (notes?.trim()) msg += `\nNote aggiuntive: ${notes.trim()}`;
  return msg;
}

function parseAiItems(text: string): RawItem[] {
  // Find the first [ and last ] to extract the JSON array regardless of surrounding text
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start)
    throw new Error('AI response did not contain a JSON array');
  const json = text.slice(start, end + 1);
  const parsed = JSON.parse(json) as RawItem[];
  if (!Array.isArray(parsed)) throw new Error('Parsed value is not an array');
  return parsed;
}

function toLineItems(raw: RawItem[]): LineItem[] {
  return raw.map((item, idx) => {
    const seq = idx + 1;
    const quantity = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    return {
      seq,
      description: String(item.description ?? ''),
      quantity,
      unit: String(item.unit ?? ''),
      unitPrice,
      lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
}

// ── PDF builder ───────────────────────────────────────────────────────────────

function buildPdf(jobId: number, totalAmount: number, items: LineItem[], clientName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text('CantiereSnap', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('PREVENTIVO', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Data: ${new Date().toLocaleDateString('it-IT')}`);
    doc.text(`Job n°: ${String(jobId).padStart(5, '0')}`);
    doc.text(`Cliente: ${clientName}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('N°', 50, doc.y, { width: 25, continued: true });
    doc.text('Descrizione', { width: 215, continued: true });
    doc.text('Qta', { width: 40, continued: true, align: 'right' });
    doc.text('U.M.', { width: 35, continued: true, align: 'right' });
    doc.text('Pr.Unit', { width: 60, continued: true, align: 'right' });
    doc.text('Totale', { width: 70, align: 'right' });
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    for (const item of items) {
      const y = doc.y;
      doc.text(String(item.seq), 50, y, { width: 25, continued: true });
      doc.text(item.description, { width: 215, continued: true });
      doc.text(item.quantity.toFixed(2), { width: 40, continued: true, align: 'right' });
      doc.text(item.unit, { width: 35, continued: true, align: 'right' });
      doc.text(item.unitPrice.toFixed(2), { width: 60, continued: true, align: 'right' });
      doc.text(item.lineTotal.toFixed(2), { width: 70, align: 'right' });
    }

    doc.moveDown();
    const vat = Math.round(totalAmount * 22) / 100;
    const gross = Math.round((totalAmount + vat) * 100) / 100;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Imponibile: EUR ${totalAmount.toFixed(2)}`, { align: 'right' });
    doc.text(`IVA 22%: EUR ${vat.toFixed(2)}`, { align: 'right' });
    doc.font('Helvetica-Bold').text(`TOTALE: EUR ${gross.toFixed(2)}`, { align: 'right' });

    doc.end();
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function generateQuote(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
  log: Logger,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{ description?: string; notes?: string }>(event);
  const description = body.description?.trim() ?? '';

  if (description.length < 20)
    return badRequest('VALIDATION_ERROR', 'description must be at least 20 characters.', 'description');

  const [jobResult, quoteCheck] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` } }),
    ),
    docClient.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'QUOTE' } }),
    ),
  ]);

  if (!jobResult.Item) return notFound('Job not found.');
  if (quoteCheck.Item) return conflict('A quote already exists for this job. Use PATCH to edit items.');

  const userMessage = buildUserMessage(description, body.notes);
  const start = Date.now();

  let rawItems: RawItem[];
  try {
    const message = await anthropicClient.messages.create({
      model: QUOTE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = (message.content[0] as { type: string; text: string }).text;
    log.info('Claude raw response', { preview: text.slice(0, 500) });
    rawItems = parseAiItems(text);
  } catch (err) {
    log.error('Anthropic API error', err);
    return badGateway('AI quote generation is unavailable. Please try again or enter items manually.');
  }

  const generationTimeMs = Date.now() - start;

  if (!Array.isArray(rawItems) || rawItems.length === 0)
    return badGateway('AI returned an empty or invalid response. Please try again.');

  const items = toLineItems(rawItems).slice(0, MAX_ITEMS);
  const totalAmount = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const now = new Date().toISOString();

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `JOB#${userId}#${jobIdFormatted}`,
              SK: 'QUOTE',
              entityType: 'Quote',
              totalAmount,
              currency: 'EUR',
              status: 'Draft',
              inputText: description,
              inputLength: description.length,
              generationTimeMs,
              itemCount: items.length,
              model: QUOTE_MODEL,
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        ...items.map((item) => ({
          Put: {
            TableName: TABLE,
            Item: {
              PK: `JOB#${userId}#${jobIdFormatted}`,
              SK: `QUOTE#ITEM#${padSeq(item.seq)}`,
              entityType: 'QuoteItem',
              seq: item.seq,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
            },
          },
        })),
      ],
    }),
  );

  return created({
    quote: {
      totalAmount,
      currency: 'EUR',
      status: 'Draft',
      generationTimeMs,
      inputLength: description.length,
      itemCount: items.length,
      model: QUOTE_MODEL,
      createdAt: now,
    },
    items,
  });
}

async function getQuote(userId: string, jobIdRaw: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${userId}#${jobIdFormatted}`,
        ':prefix': 'QUOTE',
      },
    }),
  );

  const all = (result.Items ?? []) as Record<string, unknown>[];
  const header = all.find((i) => i.SK === 'QUOTE');
  if (!header) return notFound('No quote found for this job.');

  const items = all
    .filter((i) => (i.SK as string).startsWith('QUOTE#ITEM#'))
    .sort((a, b) => Number(a.seq) - Number(b.seq));

  return ok({
    quote: {
      totalAmount: header.totalAmount,
      currency: header.currency,
      status: header.status,
      itemCount: header.itemCount,
      pdfS3Key: header.pdfS3Key ?? null,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
    },
    items: items.map((i) => ({
      seq: i.seq,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
  });
}

async function editQuote(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{ items?: unknown }>(event);
  if (!Array.isArray(body.items) || body.items.length === 0)
    return badRequest('VALIDATION_ERROR', 'items must be a non-empty array.', 'items');

  if (body.items.length > MAX_ITEMS)
    return badRequest('VALIDATION_ERROR', `A quote may not exceed ${MAX_ITEMS} line items.`, 'items');

  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i] as Record<string, unknown>;
    const desc = String(item.description ?? '');
    if (desc.length < 5 || desc.length > 500)
      return badRequest('VALIDATION_ERROR', `Item ${i + 1}: description must be 5–500 characters.`, 'items');
    const qty = Number(item.quantity);
    if (!isFinite(qty) || qty <= 0)
      return badRequest('VALIDATION_ERROR', `Item ${i + 1}: quantity must be greater than 0.`, 'items');
    const unit = String(item.unit ?? '');
    if (unit.length < 1 || unit.length > 20)
      return badRequest('VALIDATION_ERROR', `Item ${i + 1}: unit must be 1–20 characters.`, 'items');
    const price = Number(item.unitPrice);
    if (!isFinite(price) || price < 0)
      return badRequest('VALIDATION_ERROR', `Item ${i + 1}: unitPrice must be >= 0.`, 'items');
  }

  const pk = `JOB#${userId}#${jobIdFormatted}`;

  const [quoteResult, existingResult] = await Promise.all([
    docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: 'QUOTE' } })),
    docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'QUOTE#ITEM#' },
      }),
    ),
  ]);

  if (!quoteResult.Item) return notFound('No quote found for this job.');

  const newItems: LineItem[] = (body.items as Record<string, unknown>[]).map((item, idx) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    return {
      seq: idx + 1,
      description: String(item.description),
      quantity,
      unit: String(item.unit),
      unitPrice,
      lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    };
  });

  const totalAmount = Math.round(newItems.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const now = new Date().toISOString();
  const oldItems = (existingResult.Items ?? []) as Record<string, unknown>[];

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { PK: pk, SK: 'QUOTE' },
            UpdateExpression: 'SET totalAmount = :total, itemCount = :count, updatedAt = :now',
            ExpressionAttributeValues: { ':total': totalAmount, ':count': newItems.length, ':now': now },
          },
        },
        ...oldItems.map((item) => ({
          Delete: { TableName: TABLE, Key: { PK: pk, SK: item.SK as string } },
        })),
        ...newItems.map((item) => ({
          Put: {
            TableName: TABLE,
            Item: {
              PK: pk,
              SK: `QUOTE#ITEM#${padSeq(item.seq)}`,
              entityType: 'QuoteItem',
              seq: item.seq,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
            },
          },
        })),
      ],
    }),
  );

  return ok({
    quote: {
      totalAmount,
      itemCount: newItems.length,
      status: quoteResult.Item.status,
      updatedAt: now,
    },
    items: newItems,
  });
}

async function approveQuote(userId: string, jobIdRaw: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const [quoteResult, jobResult] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'QUOTE' } }),
    ),
    docClient.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` } }),
    ),
  ]);

  if (!quoteResult.Item) return notFound('No quote found for this job.');
  if (!jobResult.Item) return notFound('Job not found.');

  const quote = quoteResult.Item as Record<string, unknown>;
  const job = jobResult.Item as Record<string, unknown>;

  if (quote.status === 'Approved')
    return badRequest('VALIDATION_ERROR', 'Quote is already approved.');

  const now = new Date().toISOString();
  const transactItems: object[] = [
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'QUOTE' },
        UpdateExpression: 'SET #qs = :approved, approvedAt = :now, updatedAt = :now',
        ExpressionAttributeNames: { '#qs': 'status' },
        ExpressionAttributeValues: { ':approved': 'Approved', ':now': now },
      },
    },
  ];

  const jobAdvanced = job.status === 'Quote';
  if (jobAdvanced) {
    transactItems.push({
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` },
        UpdateExpression: 'SET #js = :accepted, GSI1SK = :gsi1sk, updatedAt = :now',
        ExpressionAttributeNames: { '#js': 'status' },
        ExpressionAttributeValues: {
          ':accepted': 'Accepted',
          ':gsi1sk': `JOB#Accepted#${job.createdAt as string}`,
          ':now': now,
        },
      },
    });
  }

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  return ok({
    status: 'Approved',
    totalAmount: quote.totalAmount,
    itemCount: quote.itemCount,
    approvedAt: now,
    jobAdvanced,
  });
}

async function generateQuotePdf(userId: string, jobIdRaw: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const [quoteQueryResult, jobResult] = await Promise.all([
    docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `JOB#${userId}#${jobIdFormatted}`,
          ':prefix': 'QUOTE',
        },
      }),
    ),
    docClient.send(
      new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` } }),
    ),
  ]);

  const allItems = (quoteQueryResult.Items ?? []) as Record<string, unknown>[];
  const quoteHeader = allItems.find((i) => i.SK === 'QUOTE');
  if (!quoteHeader) return notFound('No quote found for this job.');
  if (!jobResult.Item) return notFound('Job not found.');

  const lineItems: LineItem[] = allItems
    .filter((i) => (i.SK as string).startsWith('QUOTE#ITEM#'))
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((i) => ({
      seq: Number(i.seq),
      description: String(i.description),
      quantity: Number(i.quantity),
      unit: String(i.unit),
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.lineTotal),
    }));

  const clientName = String(jobResult.Item.clientName ?? 'N/A');
  const totalAmount = Number(quoteHeader.totalAmount ?? 0);

  const pdfBuffer = await buildPdf(numId, totalAmount, lineItems, clientName);
  const pdfS3Key = `users/${userId}/jobs/${jobIdFormatted}/quote.pdf`;
  await putObject(BUCKET, pdfS3Key, pdfBuffer, 'application/pdf');

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: 'QUOTE' },
      UpdateExpression: 'SET pdfS3Key = :key, updatedAt = :now',
      ExpressionAttributeValues: { ':key': pdfS3Key, ':now': new Date().toISOString() },
    }),
  );

  const pdfUrl = await getPresignedUrl(BUCKET, pdfS3Key);

  return ok({
    pdfUrl,
    status: quoteHeader.status,
    totalAmount,
    itemCount: quoteHeader.itemCount,
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('quotes', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;
  const jobId = event.pathParameters?.jobId ?? '';

  try {
    if (resource === '/jobs/{jobId}/quote') {
      if (method === 'GET') return await getQuote(userId, jobId);
      if (method === 'PATCH') return await editQuote(event, userId, jobId);
    }
    if (resource === '/jobs/{jobId}/quote/generate' && method === 'POST')
      return await generateQuote(event, userId, jobId, log);
    if (resource === '/jobs/{jobId}/quote/items') {
      if (method === 'POST') return await editQuote(event, userId, jobId);
    }
    if (resource === '/jobs/{jobId}/quote/items/{seq}') {
      if (method === 'PUT') return await editQuote(event, userId, jobId);
      if (method === 'DELETE') return await editQuote(event, userId, jobId);
    }
    if (resource === '/jobs/{jobId}/quote/finalize' && method === 'POST')
      return await approveQuote(userId, jobId);
    if (resource === '/jobs/{jobId}/quote/send' && method === 'POST')
      return await generateQuotePdf(userId, jobId);
    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
