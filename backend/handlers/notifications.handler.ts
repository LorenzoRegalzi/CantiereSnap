import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger } from '../shared/logger';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { ok, badRequest, notFound, internalError } from '../shared/response';

const TABLE = process.env.TABLE_NAME!;

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

function toNotificationItem(item: Record<string, unknown>) {
  return {
    type: item.type,
    channel: item.channel,
    recipientEmail: item.recipientEmail ?? null,
    recipientPhone: item.recipientPhone ?? null,
    invoiceNumber: item.invoiceNumber ?? null,
    jobId: item.jobId ?? null,
    status: item.status,
    createdAt: item.createdAt,
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function listNotifications(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const limit = Math.min(parseInt(qs.limit ?? '20', 10) || 20, 50);
  const exclusiveStartKey = qs.nextToken ? decodeToken(qs.nextToken) : undefined;

  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':prefix': 'NOTIFY#',
      },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  const items = (result.Items ?? []) as Record<string, unknown>[];
  const lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;

  return ok({
    items: items.map(toNotificationItem),
    nextToken: lastKey ? encodeToken(lastKey) : null,
  });
}

async function updatePreferences(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ emailEnabled?: unknown; smsEnabled?: unknown }>(event);

  const hasEmail = 'emailEnabled' in (body as Record<string, unknown>);
  const hasSms = 'smsEnabled' in (body as Record<string, unknown>);

  if (!hasEmail && !hasSms)
    return badRequest('VALIDATION_ERROR', 'At least one preference field must be provided (emailEnabled, smsEnabled).');

  if (hasEmail && typeof body.emailEnabled !== 'boolean')
    return badRequest('VALIDATION_ERROR', 'emailEnabled must be a boolean.', 'emailEnabled');

  if (hasSms && typeof body.smsEnabled !== 'boolean')
    return badRequest('VALIDATION_ERROR', 'smsEnabled must be a boolean.', 'smsEnabled');

  const setClauses: string[] = ['updatedAt = :now'];
  const exprValues: Record<string, unknown> = { ':now': new Date().toISOString() };

  if (hasEmail) {
    setClauses.push('emailEnabled = :emailEnabled');
    exprValues[':emailEnabled'] = body.emailEnabled;
  }
  if (hasSms) {
    setClauses.push('smsEnabled = :smsEnabled');
    exprValues[':smsEnabled'] = body.smsEnabled;
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: 'PREFERENCES' },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  const attrs = result.Attributes as Record<string, unknown>;
  return ok({
    emailEnabled: attrs.emailEnabled ?? null,
    smsEnabled: attrs.smsEnabled ?? null,
    updatedAt: attrs.updatedAt,
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('notifications', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;

  try {
    if (resource === '/notifications') {
      if (method === 'GET') return await listNotifications(event, userId);
    }
    if (resource === '/notifications/preferences') {
      if (method === 'PATCH') return await updatePreferences(event, userId);
    }
    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
