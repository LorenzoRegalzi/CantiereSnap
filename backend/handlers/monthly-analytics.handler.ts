import type { Context } from 'aws-lambda';
import { ScanCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { createLogger, type Logger } from '../shared/logger';

const TABLE = process.env.TABLE_NAME!;

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserProfile {
  PK: string; // USER#<userId>
  SK: string; // PROFILE
  email: string;
  fullName: string;
}

interface JobHeader {
  SK: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface InvoiceItem {
  SK: string;
  GSI1SK: string; // INV#<status>#<createdAt>
  status: string;
  totalAmount: number;
  createdAt: string;
}

interface QuoteItem {
  SK: string;
  createdAt: string;
}

interface MaterialItem {
  SK: string;
  cost: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function previousMonthWindow(): { month: string; start: string; end: string } {
  const now = new Date();
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth(); // 1-based previous month

  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = `${year}-${pad(month)}`;
  const start = `${monthStr}-01T00:00:00.000Z`;

  // End: first day of current month (exclusive)
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = endDate.toISOString();

  return { month: monthStr, start, end };
}

async function scanAllProfiles(): Promise<UserProfile[]> {
  const profiles: UserProfile[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'PROFILE' },
        ExclusiveStartKey: lastKey,
      }),
    );
    profiles.push(...((result.Items ?? []) as UserProfile[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return profiles;
}

async function queryAll<T>(pk: string, skPrefix: string): Promise<T[]> {
  const items: T[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': skPrefix },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

async function queryGsi1All<T>(gsi1pk: string, skPrefix: string): Promise<T[]> {
  const items: T[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'StatusIndex',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': gsi1pk, ':prefix': skPrefix },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

function padJobId(n: number): string {
  return String(n).padStart(5, '0');
}

// ── Per-user aggregation ──────────────────────────────────────────────────────

async function aggregateForUser(
  userId: string,
  window: { month: string; start: string; end: string },
  log: Logger,
): Promise<void> {
  const pk = `USER#${userId}`;

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const allJobHeaders = await queryAll<JobHeader>(pk, 'JOB#');

  const jobsInMonth = allJobHeaders.filter(
    (j) => j.createdAt >= window.start && j.createdAt < window.end,
  );
  const jobsCreated = jobsInMonth.length;
  const jobsCompleted = jobsInMonth.filter((j) => j.status === 'Completed').length;
  const completionRate = jobsCreated > 0 ? jobsCompleted / jobsCreated : 0;

  // ── Invoices ──────────────────────────────────────────────────────────────
  // Query GSI-1 for all user invoices (StatusIndex uses GSI1PK/GSI1SK keys)
  const allInvoices = await queryGsi1All<InvoiceItem>(pk, 'INV#');

  const paidInMonth = allInvoices.filter(
    (inv) =>
      inv.status === 'Paid' && inv.createdAt >= window.start && inv.createdAt < window.end,
  );
  const invoicesPaid = paidInMonth.length;
  const totalRevenue = paidInMonth.reduce(
    (sum, inv) => sum + (typeof inv.totalAmount === 'number' ? inv.totalAmount : 0),
    0,
  );

  const invoicesOverdue = allInvoices.filter((inv) => inv.status === 'Overdue').length;

  // ── Materials and Quote-to-Invoice time ───────────────────────────────────
  let totalMaterialCost = 0;
  const quoteToInvoiceDays: number[] = [];

  for (const job of jobsInMonth) {
    // Extract jobId from SK = 'JOB#00003'
    const jobIdStr = job.SK.slice('JOB#'.length);
    const jobIdNum = parseInt(jobIdStr, 10);
    if (isNaN(jobIdNum)) continue;
    const jobPk = `JOB#${userId}#${padJobId(jobIdNum)}`;

    // Materials
    try {
      const materials = await queryAll<MaterialItem>(jobPk, 'MATERIAL#');
      for (const mat of materials) {
        if (typeof mat.cost === 'number') totalMaterialCost += mat.cost;
      }
    } catch (err) {
      log.warn('Failed to query materials', { jobPk, err });
    }

    // Quote creation date (for quote-to-invoice days)
    let quoteCreatedAt: string | null = null;
    try {
      const quotes = await queryAll<QuoteItem>(jobPk, 'QUOTE');
      const quoteHeader = quotes.find((q) => q.SK === 'QUOTE');
      if (quoteHeader) quoteCreatedAt = quoteHeader.createdAt;
    } catch (err) {
      log.warn('Failed to query quote', { jobPk, err });
    }

    if (quoteCreatedAt) {
      try {
        const jobInvoices = await queryAll<{ SK: string; createdAt: string }>(jobPk, 'INVOICE');
        const inv = jobInvoices.find((i) => i.SK === 'INVOICE');
        if (inv && inv.createdAt) {
          const diffMs = new Date(inv.createdAt).getTime() - new Date(quoteCreatedAt).getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays >= 0) quoteToInvoiceDays.push(diffDays);
        }
      } catch (err) {
        log.warn('Failed to query invoice', { jobPk, err });
      }
    }
  }

  const avgQuoteToInvoiceDays =
    quoteToInvoiceDays.length > 0
      ? quoteToInvoiceDays.reduce((a, b) => a + b, 0) / quoteToInvoiceDays.length
      : 0;

  // ── Save analytics item ───────────────────────────────────────────────────
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: pk,
        SK: `ANALYTICS#${window.month}`,
        entityType: 'MonthlyAnalytics',
        month: window.month,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        jobsCreated,
        jobsCompleted,
        completionRate: Math.round(completionRate * 1000) / 1000,
        avgQuoteToInvoiceDays: Math.round(avgQuoteToInvoiceDays * 10) / 10,
        totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
        invoicesPaid,
        invoicesOverdue,
        aggregatedAt: now,
      },
    }),
  );

  log.info('Analytics saved', { userId, month: window.month, totalRevenue, jobsCreated, jobsCompleted });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: { source?: string }, context: Context): Promise<void> => {
  const log = createLogger('monthly-analytics', context.awsRequestId);
  log.info('monthly-analytics triggered', { source: event.source });

  const window = previousMonthWindow();
  log.info('Aggregating month', { month: window.month, start: window.start, end: window.end });

  const profiles = await scanAllProfiles();
  log.info('Profiles found', { count: profiles.length });

  for (const profile of profiles) {
    const userId = profile.PK.slice('USER#'.length);
    try {
      await aggregateForUser(userId, window, log);
    } catch (err) {
      log.error('Failed to aggregate analytics for user', { userId, err });
    }
  }

  log.info('monthly-analytics complete');
};
