import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger } from '../shared/logger';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import {
  ok,
  created,
  badRequest,
  notFound,
  conflict,
  internalError,
} from '../shared/response';

const TABLE = process.env.TABLE_NAME!;

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = 'Quote' | 'Accepted' | 'InProgress' | 'Completed' | 'Invoiced' | 'Cancelled';

interface JobItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
  entityType: 'Job';
  jobId: number;
  clientId: string;
  clientName: string;
  description: string;
  address: string;
  targetDate: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

interface PartitionItem {
  entityType: string;
  [key: string]: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['Quote', 'Accepted', 'InProgress', 'Completed', 'Invoiced']);

const STATUS_TRANSITIONS: Record<string, string> = {
  Quote: 'Accepted',
  Accepted: 'InProgress',
  InProgress: 'Completed',
  Completed: 'Invoiced',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.claims?.sub as string;
}

function padJobId(n: number): string {
  return String(n).padStart(5, '0');
}

function parseBody<T>(event: APIGatewayProxyEvent): T {
  try {
    return JSON.parse(event.body ?? '{}') as T;
  } catch {
    return {} as T;
  }
}

function toJobResponse(item: Partial<JobItem>) {
  const jobId = item.jobId!;
  return {
    jobId,
    jobIdFormatted: padJobId(jobId),
    clientId: item.clientId!,
    clientName: item.clientName!,
    description: item.description!,
    address: item.address!,
    targetDate: item.targetDate!,
    status: item.status!,
    createdAt: item.createdAt!,
    updatedAt: item.updatedAt!,
  };
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

// ── Route handlers ────────────────────────────────────────────────────────────

async function createJob(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody<{
    clientId?: string;
    description?: string;
    address?: string;
    targetDate?: string;
  }>(event);

  if (!body.clientId)
    return badRequest('VALIDATION_ERROR', 'clientId is required.', 'clientId');
  if (!body.description || body.description.length < 10)
    return badRequest('VALIDATION_ERROR', 'description must be at least 10 characters.', 'description');
  if (body.description.length > 5000)
    return badRequest('VALIDATION_ERROR', 'description must not exceed 5000 characters.', 'description');
  if (!body.address || body.address.length < 5)
    return badRequest('VALIDATION_ERROR', 'address is required (minimum 5 characters).', 'address');
  if (body.address.length > 500)
    return badRequest('VALIDATION_ERROR', 'address must not exceed 500 characters.', 'address');
  if (!body.targetDate)
    return badRequest('VALIDATION_ERROR', 'targetDate is required.', 'targetDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate))
    return badRequest('VALIDATION_ERROR', 'targetDate must be in YYYY-MM-DD format.', 'targetDate');
  if (body.targetDate < new Date().toISOString().slice(0, 10))
    return badRequest('VALIDATION_ERROR', 'targetDate must be today or a future date.', 'targetDate');

  // Fetch client to denormalise clientName into the job header
  const clientResult = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `CLIENT#${body.clientId}` },
      ProjectionExpression: 'clientName',
    }),
  );
  if (!clientResult.Item) return notFound('Client not found.');
  const clientName = clientResult.Item.clientName as string;

  // Atomically increment the per-user job counter (creates the item on first use)
  const counterResult = await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: 'COUNTER#JOB' },
      UpdateExpression: 'ADD lastJobId :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const jobId = counterResult.Attributes!.lastJobId as number;
  const jobIdFormatted = padJobId(jobId);
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${userId}`,
        SK: `JOB#${jobIdFormatted}`,
        GSI1PK: `USER#${userId}`,
        GSI1SK: `JOB#Quote#${now}`,
        GSI2PK: `USER_JOBS#${userId}`,
        GSI2SK: now,
        entityType: 'Job',
        jobId,
        clientId: body.clientId,
        clientName,
        description: body.description,
        address: body.address,
        targetDate: body.targetDate,
        status: 'Quote',
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return created({
    jobId,
    jobIdFormatted,
    clientId: body.clientId,
    clientName,
    description: body.description,
    address: body.address,
    targetDate: body.targetDate,
    status: 'Quote',
    createdAt: now,
    updatedAt: now,
  });
}

async function listJobs(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const statusFilter = qs.status;
  const search = qs.search?.trim();
  const startDate = qs.startDate;
  const endDate = qs.endDate;
  const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
  const exclusiveStartKey = qs.nextToken ? decodeToken(qs.nextToken) : undefined;

  let items: PartitionItem[] = [];
  let lastKey: Record<string, unknown> | undefined;

  if (statusFilter) {
    const statuses = statusFilter
      .split(',')
      .map((s) => s.trim())
      .filter((s) => VALID_STATUSES.has(s));
    if (statuses.length === 0)
      return badRequest(
        'VALIDATION_ERROR',
        'Invalid status. Accepted values: Quote, Accepted, InProgress, Completed, Invoiced.',
        'status',
      );

    // Always exclude soft-deleted jobs; optionally apply search filter.
    const filterValues: Record<string, unknown> = { ':cancelled': 'Cancelled' };
    let filterExpr = '#jobStatus <> :cancelled';
    if (search) {
      filterValues[':search'] = search;
      filterExpr += ' AND (contains(description, :search) OR contains(clientName, :search))';
    }

    const results = await Promise.all(
      statuses.map((status) =>
        docClient.send(
          new QueryCommand({
            TableName: TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
            ExpressionAttributeValues: {
              ':pk': `USER#${userId}`,
              ':prefix': `JOB#${status}#`,
              ...filterValues,
            },
            FilterExpression: filterExpr,
            ExpressionAttributeNames: { '#jobStatus': 'status' },
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        ),
      ),
    );

    items = results.flatMap((r) => (r.Items ?? []) as PartitionItem[]).slice(0, limit);
    lastKey = results[results.length - 1]?.LastEvaluatedKey as Record<string, unknown> | undefined;
  } else if (startDate || endDate) {
    // DueDateIndex only projects a small attribute set (designed for invoice notifications)
    // and GSI2SK stores createdAt, not targetDate.  Use StatusIndex instead — it projects
    // ALL attributes — and apply a FilterExpression on targetDate (YYYY-MM-DD string).
    const filterValues: Record<string, unknown> = { ':cancelled': 'Cancelled' };
    let filterExpr = '#jobStatus <> :cancelled';

    if (startDate && endDate) {
      filterExpr += ' AND targetDate BETWEEN :start AND :end';
      filterValues[':start'] = startDate;
      filterValues[':end'] = endDate;
    } else if (startDate) {
      filterExpr += ' AND targetDate >= :start';
      filterValues[':start'] = startDate;
    } else {
      filterExpr += ' AND targetDate <= :end';
      filterValues[':end'] = endDate;
    }

    if (search) {
      filterValues[':search'] = search;
      filterExpr += ' AND (contains(description, :search) OR contains(clientName, :search))';
    }

    const allStatuses = [...VALID_STATUSES];
    const results = await Promise.all(
      allStatuses.map((status) =>
        docClient.send(
          new QueryCommand({
            TableName: TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
            ExpressionAttributeValues: {
              ':pk': `USER#${userId}`,
              ':prefix': `JOB#${status}#`,
              ...filterValues,
            },
            FilterExpression: filterExpr,
            ExpressionAttributeNames: { '#jobStatus': 'status' },
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
            ScanIndexForward: false,
          }),
        ),
      ),
    );

    items = results.flatMap((r) => (r.Items ?? []) as PartitionItem[]).slice(0, limit);
    lastKey = results[results.length - 1]?.LastEvaluatedKey as Record<string, unknown> | undefined;
  } else {
    // Default: GSI-1, all statuses, newest first, excluding soft-deleted jobs.
    // The main-table query (PK = USER#userId, SK begins_with JOB#) is unreliable
    // because DynamoDB's Limit counts *scanned* items before FilterExpression is
    // applied, and CLIENT#* / COUNTER#* items share the same PK and consume the
    // Limit before any JOB# items are reached.  GSI-1 is keyed on GSI1PK =
    // USER#userId so it only contains Job items — no cross-entity contamination.
    const allStatuses = [...VALID_STATUSES];
    const filterValues: Record<string, unknown> = { ':cancelled': 'Cancelled' };
    let filterExpr = '#jobStatus <> :cancelled';

    if (search) {
      filterValues[':search'] = search;
      filterExpr += ' AND (contains(description, :search) OR contains(clientName, :search))';
    }

    const results = await Promise.all(
      allStatuses.map((status) =>
        docClient.send(
          new QueryCommand({
            TableName: TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
            ExpressionAttributeValues: {
              ':pk': `USER#${userId}`,
              ':prefix': `JOB#${status}#`,
              ...filterValues,
            },
            ExpressionAttributeNames: { '#jobStatus': 'status' },
            FilterExpression: filterExpr,
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
            ScanIndexForward: false,
          }),
        ),
      ),
    );

    items = results.flatMap((r) => (r.Items ?? []) as PartitionItem[]).slice(0, limit);
    lastKey = results[results.length - 1]?.LastEvaluatedKey as Record<string, unknown> | undefined;
  }

  return ok({
    items: items.map((item) => toJobResponse(item as Partial<JobItem>)),
    nextToken: lastKey ? encodeToken(lastKey) : null,
  });
}

async function getJob(userId: string, jobId: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return notFound('Job not found.');

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `JOB#${padJobId(numId)}` },
    }),
  );

  if (!result.Item || result.Item.status === 'Cancelled') return notFound('Job not found.');
  return ok(toJobResponse(result.Item as Partial<JobItem>));
}

async function getJobDetails(userId: string, jobId: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const padded = padJobId(numId);

  // Fetch header and full job partition in parallel (AP-08 + AP-14)
  const [headerResult, partitionResult] = await Promise.all([
    docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `JOB#${padded}` },
      }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `JOB#${userId}#${padded}` },
      }),
    ),
  ]);

  if (!headerResult.Item || headerResult.Item.status === 'Cancelled')
    return notFound('Job not found.');

  const children = (partitionResult.Items ?? []) as PartitionItem[];

  const statusHistory = children
    .filter((i) => i.entityType === 'StatusTransition')
    .sort((a, b) => String(a.changedAt).localeCompare(String(b.changedAt)))
    .map((i) => ({ fromStatus: i.fromStatus ?? null, toStatus: i.toStatus, changedAt: i.changedAt }));

  const quoteMeta = children.find((i) => i.entityType === 'Quote');
  const quoteItems = children
    .filter((i) => i.entityType === 'QuoteItem')
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((i) => ({
      seq: i.seq,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    }));

  const photos = children
    .filter((i) => i.entityType === 'Photo')
    .map((i) => ({
      photoId: i.photoId,
      tag: i.tag,
      s3Key: i.s3Key,
      aiDescription: i.aiDescription,
      aiDescriptionEdited: i.aiDescriptionEdited,
      uploadedAt: i.uploadedAt,
    }));

  const materials = children
    .filter((i) => i.entityType === 'Material')
    .map((i) => ({
      materialId: i.materialId,
      itemName: i.itemName,
      quantity: i.quantity,
      cost: i.cost,
      confidence: i.confidence,
      verified: i.verified,
      createdAt: i.createdAt,
    }));

  const invoiceMeta = children.find((i) => i.entityType === 'Invoice');
  const invoiceItems = children
    .filter((i) => i.entityType === 'InvoiceItem')
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((i) => ({
      seq: i.seq,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    }));

  return ok({
    job: toJobResponse(headerResult.Item as Partial<JobItem>),
    statusHistory,
    quote: quoteMeta
      ? {
          totalAmount: quoteMeta.totalAmount,
          currency: quoteMeta.currency,
          status: quoteMeta.status,
          pdfS3Key: quoteMeta.pdfS3Key ?? null,
          createdAt: quoteMeta.createdAt,
          items: quoteItems,
        }
      : null,
    photos,
    materials,
    invoice: invoiceMeta
      ? {
          invoiceNumber: invoiceMeta.invoiceNumber,
          totalAmount: invoiceMeta.totalAmount,
          vatAmount: invoiceMeta.vatAmount,
          vatRate: invoiceMeta.vatRate,
          currency: invoiceMeta.currency,
          status: invoiceMeta.status,
          dueDate: invoiceMeta.dueDate,
          xmlS3Key: invoiceMeta.xmlS3Key ?? null,
          createdAt: invoiceMeta.createdAt,
          items: invoiceItems,
        }
      : null,
  });
}

async function updateJob(
  event: APIGatewayProxyEvent,
  userId: string,
  jobId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ description?: string; address?: string; targetDate?: string }>(event);

  if (body.description !== undefined) {
    if (body.description.length < 10)
      return badRequest('VALIDATION_ERROR', 'description must be at least 10 characters.', 'description');
    if (body.description.length > 5000)
      return badRequest('VALIDATION_ERROR', 'description must not exceed 5000 characters.', 'description');
  }
  if (body.address !== undefined) {
    if (body.address.length < 5)
      return badRequest('VALIDATION_ERROR', 'address must be at least 5 characters.', 'address');
    if (body.address.length > 500)
      return badRequest('VALIDATION_ERROR', 'address must not exceed 500 characters.', 'address');
  }
  if (body.targetDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate))
    return badRequest('VALIDATION_ERROR', 'targetDate must be in YYYY-MM-DD format.', 'targetDate');

  if (!body.description && !body.address && !body.targetDate)
    return badRequest('VALIDATION_ERROR', 'No updatable fields provided.');

  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return notFound('Job not found.');

  const now = new Date().toISOString();
  const setClauses = ['updatedAt = :updatedAt'];
  const exprValues: Record<string, unknown> = { ':updatedAt': now, ':cancelled': 'Cancelled' };

  if (body.description) {
    setClauses.push('description = :description');
    exprValues[':description'] = body.description;
  }
  if (body.address) {
    setClauses.push('address = :address');
    exprValues[':address'] = body.address;
  }
  if (body.targetDate) {
    setClauses.push('targetDate = :targetDate');
    exprValues[':targetDate'] = body.targetDate;
  }

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `JOB#${padJobId(numId)}` },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND #jobStatus <> :cancelled',
        ExpressionAttributeNames: { '#jobStatus': 'status' },
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return ok(toJobResponse(result.Attributes as Partial<JobItem>));
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException')
      return notFound('Job not found.');
    throw err;
  }
}

async function updateJobStatus(
  event: APIGatewayProxyEvent,
  userId: string,
  jobId: string,
): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ status?: string }>(event);

  if (!body.status)
    return badRequest('VALIDATION_ERROR', 'status is required.', 'status');
  if (!VALID_STATUSES.has(body.status))
    return badRequest(
      'VALIDATION_ERROR',
      `Invalid status. Accepted values: ${[...VALID_STATUSES].join(', ')}.`,
      'status',
    );

  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const padded = padJobId(numId);

  const current = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `JOB#${padded}` },
    }),
  );
  if (!current.Item || current.Item.status === 'Cancelled')
    return notFound('Job not found.');

  const currentStatus = current.Item.status as string;
  const allowedNext = STATUS_TRANSITIONS[currentStatus];

  if (body.status !== allowedNext)
    return badRequest(
      'INVALID_STATUS_TRANSITION',
      `Invalid transition: from "${currentStatus}" the only allowed next status is "${allowedNext}".`,
    );

  // Transitioning to Invoiced requires an existing invoice record (AP-14 / schema §10.1)
  if (body.status === 'Invoiced') {
    const invoiceCheck = await docClient.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `JOB#${userId}#${padded}`, SK: 'INVOICE' },
        ProjectionExpression: 'PK',
      }),
    );
    if (!invoiceCheck.Item)
      return conflict('Cannot mark as Invoiced: no invoice found for this job.');
  }

  const now = new Date().toISOString();
  const createdAt = current.Item.createdAt as string;

  // Transactional update: job header + status history entry (schema §10.1)
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { PK: `USER#${userId}`, SK: `JOB#${padded}` },
            UpdateExpression: 'SET #jobStatus = :newStatus, GSI1SK = :gsi1sk, updatedAt = :now',
            ExpressionAttributeNames: { '#jobStatus': 'status' },
            ExpressionAttributeValues: {
              ':newStatus': body.status,
              ':gsi1sk': `JOB#${body.status}#${createdAt}`,
              ':now': now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `JOB#${userId}#${padded}`,
              SK: `STATUS#${now}`,
              entityType: 'StatusTransition',
              fromStatus: currentStatus,
              toStatus: body.status,
              changedAt: now,
            },
          },
        },
      ],
    }),
  );

  return ok({
    jobId: numId,
    previousStatus: currentStatus,
    newStatus: body.status,
    transitionTimestamp: now,
  });
}

async function deleteJob(userId: string, jobId: string): Promise<APIGatewayProxyResult> {
  const numId = parseInt(jobId, 10);
  if (isNaN(numId)) return notFound('Job not found.');
  const padded = padJobId(numId);

  // Fetch createdAt so we can build the updated GSI1SK.
  const current = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `JOB#${padded}` },
      ProjectionExpression: 'createdAt, #jobStatus',
      ExpressionAttributeNames: { '#jobStatus': 'status' },
    }),
  );
  if (!current.Item || current.Item.status === 'Cancelled') return notFound('Job not found.');

  const now = new Date().toISOString();
  const createdAt = current.Item.createdAt as string;

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `JOB#${padded}` },
        // Update GSI1SK so the job is removed from all valid-status index ranges.
        UpdateExpression: 'SET #jobStatus = :cancelled, GSI1SK = :gsi1sk, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND #jobStatus <> :cancelled',
        ExpressionAttributeNames: { '#jobStatus': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'Cancelled',
          ':gsi1sk': `JOB#Cancelled#${createdAt}`,
          ':now': now,
        },
      }),
    );
    return ok({ message: 'Job deleted successfully.' });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException')
      return notFound('Job not found.');
    throw err;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('jobs', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;
  const jobId = event.pathParameters?.jobId ?? '';

  try {
    if (resource === '/jobs') {
      if (method === 'POST') return await createJob(event, userId);
      if (method === 'GET') return await listJobs(event, userId);
    }
    if (resource === '/jobs/{jobId}') {
      if (method === 'GET') return await getJob(userId, jobId);
      if (method === 'PATCH') return await updateJob(event, userId, jobId);
      if (method === 'DELETE') return await deleteJob(userId, jobId);
    }
    if (resource === '/jobs/{jobId}/details') {
      if (method === 'GET') return await getJobDetails(userId, jobId);
    }
    if (resource === '/jobs/{jobId}/status') {
      if (method === 'PATCH') return await updateJobStatus(event, userId, jobId);
    }
    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
