import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, type Logger } from '../shared/logger';
import { randomUUID } from 'crypto';
import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { getPresignedUrl, putPresignedUrl } from '../shared/s3';
import { anthropicClient } from '../shared/anthropic';
import { ok, created, badRequest, notFound, noContent, internalError } from '../shared/response';

const TABLE = process.env.TABLE_NAME!;
const BUCKET = process.env.BUCKET_NAME!;
const PHOTO_MODEL = 'claude-sonnet-4-20250514';

const VALID_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const VALID_TAGS = new Set(['Before', 'After']);
const VALID_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const EXT_FROM_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

const PHOTO_PROMPT =
  'Describe the construction or renovation work visible in this photo in technical terms ' +
  'suitable for professional documentation. Focus on materials, techniques, work stages, ' +
  'and any notable observations. Keep the description concise (2–4 sentences).';

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

function generatePhotoId(): string {
  return randomUUID().replace(/-/g, '').toUpperCase().slice(0, 26);
}

function toPhotoResponse(item: Record<string, unknown>, imageUrl: string) {
  return {
    photoId: item.photoId,
    tag: item.tag,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes ?? null,
    imageUrl,
    aiDescription: item.aiDescription ?? null,
    aiDescriptionEdited: item.aiDescriptionEdited ?? false,
    uploadedAt: item.uploadedAt,
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function generateUploadUrl(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{ fileName?: string; mimeType?: string; tag?: string }>(event);

  if (!body.fileName || typeof body.fileName !== 'string')
    return badRequest('VALIDATION_ERROR', 'fileName is required.', 'fileName');

  const ext = body.fileName.includes('.')
    ? body.fileName.slice(body.fileName.lastIndexOf('.')).toLowerCase()
    : '';
  if (!VALID_EXTENSIONS.has(ext))
    return badRequest(
      'VALIDATION_ERROR',
      'fileName must end with .jpg, .jpeg, or .png.',
      'fileName',
    );

  if (!body.mimeType || !VALID_MIME_TYPES.has(body.mimeType))
    return badRequest(
      'VALIDATION_ERROR',
      'mimeType must be image/jpeg or image/png.',
      'mimeType',
    );

  if (!body.tag || !VALID_TAGS.has(body.tag))
    return badRequest('VALIDATION_ERROR', 'tag must be Before or After.', 'tag');

  const photoId = generatePhotoId();
  const fileExt = EXT_FROM_MIME[body.mimeType] ?? 'jpg';
  const s3Key = `users/${userId}/jobs/${jobIdFormatted}/photos/${photoId}.${fileExt}`;

  const uploadUrl = await putPresignedUrl(BUCKET, s3Key, body.mimeType, 900);

  return ok({
    photoId,
    s3Key,
    uploadUrl,
    expiresIn: 900,
    method: 'PUT',
    headers: {
      'Content-Type': body.mimeType,
      'x-amz-meta-tag': body.tag,
    },
  });
}

async function savePhoto(
  event: APIGatewayProxyEvent,
  userId: string,
  jobIdRaw: string,
  log: Logger,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const body = parseBody<{
    photoId?: string;
    s3Key?: string;
    tag?: string;
    mimeType?: string;
    sizeBytes?: unknown;
  }>(event);

  if (!body.photoId || typeof body.photoId !== 'string')
    return badRequest('VALIDATION_ERROR', 'photoId is required.', 'photoId');

  if (!body.s3Key || typeof body.s3Key !== 'string')
    return badRequest('VALIDATION_ERROR', 's3Key is required.', 's3Key');

  if (!body.tag || !VALID_TAGS.has(body.tag))
    return badRequest('VALIDATION_ERROR', 'tag must be Before or After.', 'tag');

  if (body.mimeType !== undefined && !VALID_MIME_TYPES.has(body.mimeType as string))
    return badRequest('VALIDATION_ERROR', 'mimeType must be image/jpeg or image/png.', 'mimeType');

  // Verify s3Key belongs to this user (prevent cross-user metadata injection)
  if (!body.s3Key.startsWith(`users/${userId}/`))
    return badRequest('VALIDATION_ERROR', 'Invalid s3Key.', 's3Key');

  const jobResult = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: `JOB#${jobIdFormatted}` } }),
  );
  if (!jobResult.Item) return notFound('Job not found.');

  const now = new Date().toISOString();
  const pk = `JOB#${userId}#${jobIdFormatted}`;
  const sk = `PHOTO#${body.photoId}`;

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk,
        SK: sk,
        entityType: 'Photo',
        photoId: body.photoId,
        s3Key: body.s3Key,
        tag: body.tag,
        mimeType: body.mimeType ?? null,
        sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : null,
        aiDescription: null,
        aiDescriptionEdited: false,
        uploadedAt: now,
      },
    }),
  );

  // Attempt AI description — failure must not fail the request
  let aiDescription: string | null = null;
  try {
    const imageUrl = await getPresignedUrl(BUCKET, body.s3Key, 3600);
    const message = await anthropicClient.messages.create({
      model: PHOTO_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: imageUrl },
            },
            { type: 'text', text: PHOTO_PROMPT },
          ],
        },
      ],
    });
    const text = (message.content[0] as { type: string; text: string }).text.trim();
    if (text) {
      aiDescription = text;
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk, SK: sk },
          UpdateExpression: 'SET aiDescription = :desc',
          ExpressionAttributeValues: { ':desc': aiDescription },
        }),
      );
    }
  } catch (err) {
    log.warn('AI description generation failed (non-fatal)', err);
  }

  const imageUrl = await getPresignedUrl(BUCKET, body.s3Key);

  return created({
    photoId: body.photoId,
    tag: body.tag,
    mimeType: body.mimeType ?? null,
    sizeBytes: typeof body.sizeBytes === 'number' ? body.sizeBytes : null,
    s3Key: body.s3Key,
    imageUrl,
    aiDescription,
    aiDescriptionEdited: false,
    uploadedAt: now,
  });
}

async function listPhotos(userId: string, jobIdRaw: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const jobIdFormatted = padJobId(numId);

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'attribute_not_exists(deletedAt)',
      ExpressionAttributeValues: {
        ':pk': `JOB#${userId}#${jobIdFormatted}`,
        ':prefix': 'PHOTO#',
      },
      ScanIndexForward: true,
    }),
  );

  const items = (result.Items ?? []) as Record<string, unknown>[];
  items.sort((a, b) =>
    String(a.uploadedAt ?? '').localeCompare(String(b.uploadedAt ?? '')),
  );

  const photosWithUrls = await Promise.all(
    items.map(async (item) => {
      const imageUrl = await getPresignedUrl(BUCKET, item.s3Key as string);
      return toPhotoResponse(item, imageUrl);
    }),
  );

  return ok({ items: photosWithUrls });
}

async function getPhoto(
  userId: string,
  jobIdRaw: string,
  photoId: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Photo not found.');
  const jobIdFormatted = padJobId(numId);

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `JOB#${userId}#${jobIdFormatted}`, SK: `PHOTO#${photoId}` },
    }),
  );

  if (!result.Item || (result.Item as Record<string, unknown>).deletedAt)
    return notFound('Photo not found.');

  const item = result.Item as Record<string, unknown>;
  const imageUrl = await getPresignedUrl(BUCKET, item.s3Key as string);
  return ok(toPhotoResponse(item, imageUrl));
}

async function deletePhoto(
  userId: string,
  jobIdRaw: string,
  photoId: string,
): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobIdRaw, 10);
  if (isNaN(numId)) return notFound('Photo not found.');
  const jobIdFormatted = padJobId(numId);

  const pk = `JOB#${userId}#${jobIdFormatted}`;
  const sk = `PHOTO#${photoId}`;

  const result = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }),
  );

  if (!result.Item || (result.Item as Record<string, unknown>).deletedAt)
    return notFound('Photo not found.');

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
  const log = createLogger('photos', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;
  const jobId = event.pathParameters?.jobId ?? '';
  const photoId = event.pathParameters?.photoId ?? '';

  try {
    if (resource === '/jobs/{jobId}/photos/upload-url' && method === 'POST')
      return await generateUploadUrl(event, userId, jobId);

    if (resource === '/jobs/{jobId}/photos') {
      if (method === 'POST') return await savePhoto(event, userId, jobId, log);
      if (method === 'GET') return await listPhotos(userId, jobId);
    }

    if (resource === '/jobs/{jobId}/photos/{photoId}') {
      if (method === 'GET') return await getPhoto(userId, jobId, photoId);
      if (method === 'PATCH') return await savePhoto(event, userId, jobId, log);
      if (method === 'DELETE') return await deletePhoto(userId, jobId, photoId);
    }

    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
