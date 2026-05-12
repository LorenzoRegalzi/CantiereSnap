import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, type Logger } from '../shared/logger';
import { randomUUID } from 'crypto';
import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { docClient } from '../shared/dynamodb';
import { s3Client, getPresignedUrl } from '../shared/s3';
import { anthropicClient } from '../shared/anthropic';
import {
  ok,
  created,
  badRequest,
  notFound,
  noContent,
  badGateway,
  internalError,
} from '../shared/response';

const TABLE = process.env.TABLE_NAME!;
const BUCKET = process.env.BUCKET_NAME!;
const PARSE_MODEL = 'claude-sonnet-4-6';

const PARSE_SYSTEM =
  'You are a construction materials assistant. Look at this receipt or invoice image and ' +
  'extract a list of material line items. Return ONLY a JSON array with no prose. Each element must have: ' +
  '"itemName" (string, the material name), "quantity" (positive number), ' +
  '"cost" (non-negative number, the total cost for that line, not the unit price). ' +
  'If a value is ambiguous or missing, make a reasonable estimate and set "lowConfidence": true. ' +
  'Example: [{"itemName":"Cemento 25kg","quantity":4,"cost":28.00}]';

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

function generateMaterialId(): string {
  return randomUUID().replace(/-/g, '').toUpperCase().slice(0, 26);
}


interface ParsedItem {
  itemName: string;
  quantity: number;
  cost: number;
  lowConfidence?: boolean;
}

function parseClaudeItems(text: string): ParsedItem[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as ParsedItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function toMaterialResponse(item: Record<string, unknown>) {
  const base = {
    materialId: item.materialId,
    itemName: item.itemName,
    quantity: item.quantity,
    cost: item.cost,
    confidence: item.confidence,
    verified: item.verified,
    createdAt: item.createdAt,
  };
  if (typeof item.confidence === 'number' && item.confidence < 80) {
    return { ...base, warning: 'Low confidence on one or more fields. Please verify.' };
  }
  return base;
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function scanReceipt(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
  log: Logger,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{ s3Key?: string }>(event);

  if (!body.s3Key || typeof body.s3Key !== 'string')
    return badRequest('VALIDATION_ERROR', 's3Key is required.', 's3Key');

  if (!body.s3Key.startsWith(`users/${userId}/`))
    return badRequest('VALIDATION_ERROR', 'Invalid s3Key.', 's3Key');

  const jobResult = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` },
    }),
  );
  if (!jobResult.Item) return notFound('Job not found.');

  // Fetch image from S3 and send directly to Claude Vision
  let parsedItems: ParsedItem[] = [];
  try {
    const s3Obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: body.s3Key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of s3Obj.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const imageB64 = Buffer.concat(chunks).toString('base64');
    const mimeType = (s3Obj.ContentType ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const message = await anthropicClient.messages.create({
      model: PARSE_MODEL,
      max_tokens: 1024,
      system: PARSE_SYSTEM,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageB64 },
        }],
      }],
    });
    const responseText = (message.content[0] as { type: string; text: string }).text;
    parsedItems = parseClaudeItems(responseText);
  } catch (err) {
    log.error('Claude Vision OCR failed', err);
    return badGateway('OCR processing failed. Please try again.');
  }

  const now = new Date().toISOString();
  const pk = `JOB#${userId}#${jobIdFormatted}`;

  const savedItems = await Promise.all(
    parsedItems.map(async (parsed) => {
      const materialId = generateMaterialId();
      const confidence = parsed.lowConfidence ? 70 : 95;

      await docClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            PK: pk,
            SK: `MATERIAL#${materialId}`,
            entityType: 'Material',
            materialId,
            itemName: parsed.itemName,
            quantity: parsed.quantity,
            cost: parsed.cost,
            confidence,
            sourceS3Key: body.s3Key,
            verified: false,
            createdAt: now,
          },
        }),
      );

      return toMaterialResponse({
        materialId,
        itemName: parsed.itemName,
        quantity: parsed.quantity,
        cost: parsed.cost,
        confidence,
        verified: false,
        createdAt: now,
      });
    }),
  );

  const sourceImageUrl = await getPresignedUrl(BUCKET, body.s3Key!);

  return ok({ items: savedItems, sourceImageUrl });
}

async function listMaterials(userId: string, jobIdRaw: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${userId}#${jobIdFormatted}`,
        ':prefix': 'MATERIAL#',
      },
      ScanIndexForward: true,
    }),
  );

  const items = (result.Items ?? []) as Record<string, unknown>[];
  items.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

  const totalCost = items.reduce(
    (sum, item) => sum + (typeof item.cost === 'number' ? item.cost : 0),
    0,
  );

  return ok({
    items: items.map((item) => toMaterialResponse(item)),
    totalCost: Math.round(totalCost * 100) / 100,
  });
}

async function addMaterial(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{ itemName?: string; quantity?: unknown; cost?: unknown }>(event);

  if (!body.itemName || typeof body.itemName !== 'string' || body.itemName.trim().length < 2)
    return badRequest('VALIDATION_ERROR', 'itemName must be at least 2 characters.', 'itemName');

  if (body.itemName.trim().length > 200)
    return badRequest('VALIDATION_ERROR', 'itemName must be at most 200 characters.', 'itemName');

  if (typeof body.quantity !== 'number' || body.quantity <= 0)
    return badRequest('VALIDATION_ERROR', 'quantity must be a number greater than 0.', 'quantity');

  if (typeof body.cost !== 'number' || body.cost < 0)
    return badRequest('VALIDATION_ERROR', 'cost must be a non-negative number.', 'cost');

  const jobResult = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` },
    }),
  );
  if (!jobResult.Item) return notFound('Job not found.');

  const now = new Date().toISOString();
  const materialId = generateMaterialId();
  const pk = `JOB#${userId}#${jobIdFormatted}`;

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk,
        SK: `MATERIAL#${materialId}`,
        entityType: 'Material',
        materialId,
        itemName: body.itemName.trim(),
        quantity: body.quantity,
        cost: body.cost,
        confidence: 100,
        sourceS3Key: null,
        verified: true,
        createdAt: now,
      },
    }),
  );

  return created({
    materialId,
    itemName: body.itemName.trim(),
    quantity: body.quantity,
    cost: body.cost,
    confidence: 100,
    verified: true,
    createdAt: now,
  });
}

async function updateMaterial(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
  materialId: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Material not found.');
  const jobIdFormatted = padJobId(numId);

  const pk = `JOB#${userId}#${jobIdFormatted}`;
  const sk = `MATERIAL#${materialId}`;

  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }),
  );
  if (!existing.Item) return notFound('Material not found.');

  const body = parseBody<{ itemName?: string; quantity?: unknown; cost?: unknown }>(event);

  if (
    body.itemName !== undefined &&
    (typeof body.itemName !== 'string' ||
      body.itemName.trim().length < 2 ||
      body.itemName.trim().length > 200)
  )
    return badRequest(
      'VALIDATION_ERROR',
      'itemName must be between 2 and 200 characters.',
      'itemName',
    );

  if (body.quantity !== undefined && (typeof body.quantity !== 'number' || body.quantity <= 0))
    return badRequest('VALIDATION_ERROR', 'quantity must be a number greater than 0.', 'quantity');

  if (body.cost !== undefined && (typeof body.cost !== 'number' || body.cost < 0))
    return badRequest('VALIDATION_ERROR', 'cost must be a non-negative number.', 'cost');

  const updates: string[] = ['verified = :verified'];
  const exprValues: Record<string, unknown> = { ':verified': true };

  if (body.itemName !== undefined) {
    updates.push('itemName = :itemName');
    exprValues[':itemName'] = body.itemName.trim();
  }
  if (body.quantity !== undefined) {
    updates.push('quantity = :quantity');
    exprValues[':quantity'] = body.quantity;
  }
  if (body.cost !== undefined) {
    updates.push('cost = :cost');
    exprValues[':cost'] = body.cost;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: exprValues,
    }),
  );

  const current = existing.Item as Record<string, unknown>;
  const updated: Record<string, unknown> = {
    materialId: current.materialId,
    itemName: body.itemName !== undefined ? body.itemName.trim() : current.itemName,
    quantity: body.quantity !== undefined ? body.quantity : current.quantity,
    cost: body.cost !== undefined ? body.cost : current.cost,
    confidence: current.confidence,
    verified: true,
    createdAt: current.createdAt,
  };

  return ok(toMaterialResponse(updated));
}

async function deleteMaterial(
  userId: string,
  jobIdRaw: string,
  materialId: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Material not found.');
  const jobIdFormatted = padJobId(numId);

  const pk = `JOB#${userId}#${jobIdFormatted}`;
  const sk = `MATERIAL#${materialId}`;

  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }),
  );
  if (!existing.Item) return notFound('Material not found.');

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'SET deletedAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }),
  );

  return noContent();
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('ocr', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;
  const jobId = event.pathParameters?.jobId ?? '';
  const materialId = event.pathParameters?.materialId ?? '';

  try {
    if (resource === '/jobs/{jobId}/materials/scan' && method === 'POST')
      return await scanReceipt(event, userId, jobId, log);

    if (resource === '/jobs/{jobId}/materials') {
      if (method === 'GET') return await listMaterials(userId, jobId);
      if (method === 'POST') return await addMaterial(event, userId, jobId);
    }

    if (resource === '/jobs/{jobId}/materials/{materialId}') {
      if (method === 'PUT') return await updateMaterial(event, userId, jobId, materialId);
      if (method === 'DELETE') return await deleteMaterial(userId, jobId, materialId);
    }

    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
