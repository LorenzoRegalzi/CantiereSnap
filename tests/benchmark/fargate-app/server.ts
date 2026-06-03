/**
 * Fargate benchmark server for CantiereSnap RQ3 comparison.
 *
 * Wraps the same Lambda handler code so both platforms execute identical business
 * logic against the same DynamoDB table and S3 bucket.
 *
 * Key architectural difference: the quote generation endpoint runs Claude
 * SYNCHRONOUSLY here — there is no API Gateway 29-second timeout on Fargate so no
 * async dispatch pattern is needed. This is documented in the thesis as a genuine
 * trade-off: Lambda requires a 202+polling workaround; Fargate returns 201 directly
 * in ~25 seconds.
 */

import express, { Request, Response, NextFunction } from 'express';
import { handler as jobsHandler } from './backend/handlers/jobs.handler';
import { anthropicClient } from './backend/shared/anthropic';
import { docClient } from './backend/shared/dynamodb';
import { GetCommand, PutCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { expressToApiGatewayEvent, makeLambdaContext } from './adapter';

// ── Shared quote utilities (identical to quotes.handler.ts) ──────────────────

const QUOTE_MODEL = 'claude-sonnet-4-6';
const MAX_ITEMS = 30;

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

interface RawItem {
  seq?: unknown; description?: unknown; quantity?: unknown;
  unit?: unknown; unitPrice?: unknown; lineTotal?: unknown;
}
interface LineItem {
  seq: number; description: string; quantity: number;
  unit: string; unitPrice: number; lineTotal: number;
}

function parseAiItems(text: string): RawItem[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start)
    throw new Error('AI response did not contain a JSON array');
  return JSON.parse(text.slice(start, end + 1)) as RawItem[];
}

function toLineItems(raw: RawItem[]): LineItem[] {
  return raw.map((item, idx) => {
    const quantity = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    return {
      seq: idx + 1,
      description: String(item.description ?? ''),
      quantity,
      unit: String(item.unit ?? ''),
      unitPrice,
      lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
}

function padJobId(n: number): string { return String(n).padStart(5, '0'); }
function padSeq(n: number): string  { return String(n).padStart(3, '0'); }

function getUserIdFromReq(req: Request): string | null {
  const auth = (req.headers.authorization ?? '') as string;
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const parts = token.split('.');
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString()) as Record<string, unknown>;
    return (decoded.sub as string) ?? null;
  } catch {
    return null;
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', platform: 'fargate', timestamp: new Date().toISOString() });
});

// ── GET /jobs — delegates to jobs.handler (same code as Lambda) ───────────────

app.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = expressToApiGatewayEvent(req, '/jobs');
    const result = await jobsHandler(event, makeLambdaContext());
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (err) {
    next(err);
  }
});

// ── POST /jobs — delegates to jobs.handler (same code as Lambda) ──────────────

app.post('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = expressToApiGatewayEvent(req, '/jobs');
    const result = await jobsHandler(event, makeLambdaContext());
    res.status(result.statusCode).json(JSON.parse(result.body));
  } catch (err) {
    next(err);
  }
});

// ── POST /jobs/:jobId/quote/generate — SYNCHRONOUS (Fargate has no 29s limit) ─
//
// On Lambda, this endpoint returns 202 immediately and invokes the handler again
// asynchronously because API Gateway has a hard 29-second limit. On Fargate there
// is no such constraint, so the Claude API call runs synchronously and the full
// quote is returned in a single ~25-second HTTP response.
// This is the primary architectural difference measured in the benchmark.

app.post('/jobs/:jobId/quote/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) { res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } }); return; }

    const numId = parseInt(req.params.jobId, 10);
    if (isNaN(numId)) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found.' } }); return; }
    const jobIdFormatted = padJobId(numId);

    const { description: rawDesc, notes } = req.body as { description?: string; notes?: string };
    const description = rawDesc?.trim() ?? '';
    if (description.length < 20) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'description must be at least 20 characters.', field: 'description' } });
      return;
    }

    const TABLE = process.env.TABLE_NAME!;
    const pk = `JOB#${userId}#${jobIdFormatted}`;

    const [jobRes, quoteRes] = await Promise.all([
      docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` } })),
      docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: 'QUOTE' } })),
    ]);
    if (!jobRes.Item) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found.' } }); return; }
    if (quoteRes.Item && quoteRes.Item.status !== 'processing')
      { res.status(409).json({ error: { code: 'CONFLICT', message: 'A quote already exists for this job. Use PATCH to edit items.' } }); return; }

    const userMessage = `Descrizione lavori: ${description}${notes?.trim() ? `\nNote aggiuntive: ${notes.trim()}` : ''}`;
    const start = Date.now();

    // Call Claude synchronously — no timeout concern on Fargate
    const message = await anthropicClient.messages.create({
      model: QUOTE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = (message.content[0] as { type: string; text: string }).text;
    const rawItems = parseAiItems(text);

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(502).json({ error: { code: 'AI_SERVICE_ERROR', message: 'AI returned an empty or invalid response.' } });
      return;
    }

    const items = toLineItems(rawItems).slice(0, MAX_ITEMS);
    const totalAmount = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
    const generationTimeMs = Date.now() - start;
    const now = new Date().toISOString();

    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: pk, SK: 'QUOTE',
              entityType: 'Quote',
              totalAmount, currency: 'EUR', status: 'Draft',
              inputText: description, inputLength: description.length,
              generationTimeMs, itemCount: items.length,
              model: QUOTE_MODEL, createdAt: now, updatedAt: now,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        ...items.map(item => ({
          Put: {
            TableName: TABLE,
            Item: {
              PK: pk, SK: `QUOTE#ITEM#${padSeq(item.seq)}`,
              entityType: 'QuoteItem',
              seq: item.seq, description: item.description,
              quantity: item.quantity, unit: item.unit,
              unitPrice: item.unitPrice, lineTotal: item.lineTotal,
            },
          },
        })),
      ],
    }));

    res.status(201).json({
      quote: {
        totalAmount, currency: 'EUR', status: 'Draft',
        generationTimeMs, inputLength: description.length,
        itemCount: items.length, model: QUOTE_MODEL, createdAt: now,
      },
      items,
    });
  } catch (err) {
    next(err);
  }
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[fargate] unhandled error', err.message);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
  console.log(`[fargate] CantiereSnap benchmark server listening on port ${PORT}`);
  console.log(`[fargate] TABLE_NAME=${process.env.TABLE_NAME}`);
  console.log(`[fargate] BUCKET_NAME=${process.env.BUCKET_NAME}`);
});
