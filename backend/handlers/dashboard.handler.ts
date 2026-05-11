import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger } from '../shared/logger';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { ok, badRequest, notFound, internalError } from '../shared/response';

const TABLE = process.env.TABLE_NAME!;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.claims?.sub as string;
}

async function queryAll(params: {
  TableName: string;
  IndexName?: string;
  KeyConditionExpression: string;
  ExpressionAttributeValues: Record<string, unknown>;
  ExpressionAttributeNames?: Record<string, string>;
  ScanIndexForward?: boolean;
}): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({ ...params, ExclusiveStartKey: lastKey }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function getSummary(userId: string): Promise<APIGatewayProxyResult> {
  const gsi1pk = `USER#${userId}`;
  const currentMonth = new Date().toISOString().slice(0, 7);

  const [jobs, paidThisMonth, overdueInvoices] = await Promise.all([
    queryAll({
      TableName: TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': gsi1pk, ':prefix': 'JOB#' },
    }),
    queryAll({
      TableName: TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': gsi1pk, ':prefix': `INV#Paid#${currentMonth}` },
    }),
    queryAll({
      TableName: TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': gsi1pk, ':prefix': 'INV#Overdue#' },
    }),
  ]);

  const monthlyRevenue = paidThisMonth.reduce(
    (sum, inv) => sum + ((inv.totalAmount as number) ?? 0),
    0,
  );

  const nonCancelled = jobs.filter((j) => (j.status as string) !== 'Cancelled');
  const completedJobs = jobs.filter(
    (j) => (j.status as string) === 'Completed' || (j.status as string) === 'Invoiced',
  ).length;
  const completionRate = nonCancelled.length > 0 ? completedJobs / nonCancelled.length : 0;

  const invoicedWithTimestamps = jobs.filter(
    (j) =>
      (j.status as string) === 'Invoiced' &&
      typeof j.quoteCreatedAt === 'string' &&
      typeof j.invoiceCreatedAt === 'string',
  );
  let avgQuoteToInvoiceDays: number | null = null;
  if (invoicedWithTimestamps.length > 0) {
    const totalMs = invoicedWithTimestamps.reduce(
      (sum, j) =>
        sum +
        (new Date(j.invoiceCreatedAt as string).getTime() -
          new Date(j.quoteCreatedAt as string).getTime()),
      0,
    );
    avgQuoteToInvoiceDays =
      Math.round((totalMs / invoicedWithTimestamps.length / 86_400_000) * 10) / 10;
  }

  return ok({
    month: currentMonth,
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    completionRate: Math.round(completionRate * 1000) / 10,
    overdueInvoices: overdueInvoices.length,
    avgQuoteToInvoiceDays,
    totalJobs: jobs.length,
    completedJobs,
  });
}

async function getRevenue(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};

  const now = new Date();
  // Use UTC to avoid timezone-induced day shifts when converting to ISO string
  const startOfRange = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const defaultStart = startOfRange.toISOString().slice(0, 10);
  const defaultEnd = now.toISOString().slice(0, 10);

  const startDate = qs.startDate ?? defaultStart;
  const endDate = qs.endDate ?? defaultEnd;

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate))
    return badRequest(
      'VALIDATION_ERROR',
      'startDate and endDate must be in YYYY-MM-DD format.',
    );

  if (startDate > endDate)
    return badRequest('VALIDATION_ERROR', 'startDate must not be after endDate.');

  const paidInvoices = await queryAll({
    TableName: TABLE,
    IndexName: 'StatusIndex',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':start': `INV#Paid#${startDate}`,
      ':end': `INV#Paid#${endDate}T23:59:59.999Z`,
    },
  });

  const byMonth: Record<string, number> = {};
  for (const inv of paidInvoices) {
    const month = ((inv.createdAt as string) ?? '').slice(0, 7);
    if (month) byMonth[month] = (byMonth[month] ?? 0) + ((inv.totalAmount as number) ?? 0);
  }

  const months: { month: string; revenue: number }[] = [];
  const startYM = startDate.slice(0, 7);
  const endYM = endDate.slice(0, 7);
  let cur = startYM;
  while (cur <= endYM) {
    months.push({ month: cur, revenue: Math.round((byMonth[cur] ?? 0) * 100) / 100 });
    const [y, m] = cur.split('-').map(Number);
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  const total = months.reduce((sum, entry) => sum + entry.revenue, 0);

  return ok({
    startDate,
    endDate,
    months,
    total: Math.round(total * 100) / 100,
  });
}

async function getJobsStats(userId: string): Promise<APIGatewayProxyResult> {
  const jobs = await queryAll({
    TableName: TABLE,
    IndexName: 'StatusIndex',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'JOB#' },
  });

  const byStatus: Record<string, number> = {
    Quote: 0,
    Accepted: 0,
    InProgress: 0,
    Completed: 0,
    Invoiced: 0,
    Cancelled: 0,
  };
  for (const job of jobs) {
    const s = job.status as string;
    if (s in byStatus) byStatus[s]++;
  }

  return ok({ total: jobs.length, byStatus });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('dashboard', context.awsRequestId, getUserId(event));
  const userId = getUserId(event);
  const { httpMethod: method, resource } = event;

  try {
    if (resource === '/dashboard/summary' && method === 'GET') return await getSummary(userId);
    if (resource === '/dashboard/revenue' && method === 'GET')
      return await getRevenue(event, userId);
    if (resource === '/dashboard/jobs-stats' && method === 'GET')
      return await getJobsStats(userId);
    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
