import type { Context } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../shared/dynamodb';
import { sendEmail } from '../shared/ses';
import { createLogger, type Logger } from '../shared/logger';
import { overdueEmail, invoiceDueReminder } from '../shared/email-templates';

const TABLE = process.env.TABLE_NAME!;
const GSI = 'DueDateIndex';
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceProjection {
  userId: string;
  jobId: string;
  clientName: string;
  clientEmail: string;
  invoiceNumber: string;
  totalAmount: number;
  GSI2SK: string; // dueDate
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function queryAllGsi(
  gsi2pk: string,
  condition: string,
  values: Record<string, string>,
): Promise<InvoiceProjection[]> {
  const items: InvoiceProjection[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: GSI,
        KeyConditionExpression: `GSI2PK = :pk AND ${condition}`,
        ExpressionAttributeValues: { ':pk': gsi2pk, ...values },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as InvoiceProjection[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

async function logNotification(params: {
  userId: string;
  type: 'InvoiceReminder' | 'OverdueAlert';
  recipientEmail: string;
  invoiceNumber: string;
  jobId: string;
  status: 'Sent' | 'Failed';
}): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;

  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${params.userId}`,
        SK: `NOTIFY#${now}`,
        entityType: 'NotificationLog',
        type: params.type,
        channel: 'email',
        recipientEmail: params.recipientEmail,
        invoiceNumber: params.invoiceNumber,
        jobId: params.jobId,
        status: params.status,
        ttl,
        createdAt: now,
      },
    }),
  );
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleOverdueAlert(log: Logger): Promise<void> {
  const today = todayIso();
  const invoices = await queryAllGsi('INV_STATUS#Overdue', 'GSI2SK < :today', {
    ':today': today,
  });

  log.info('overdue-alert: queried overdue invoices', { count: invoices.length });

  for (const inv of invoices) {
    let emailStatus: 'Sent' | 'Failed' = 'Sent';
    const { html, text } = overdueEmail({
      clientName: inv.clientName,
      businessName: FROM_EMAIL,
      invoiceNumber: inv.invoiceNumber,
      totalAmount: inv.totalAmount,
      dueDate: inv.GSI2SK,
    });
    try {
      await sendEmail({
        to: inv.clientEmail,
        from: FROM_EMAIL,
        subject: `Fattura scaduta: ${inv.invoiceNumber}`,
        htmlBody: html,
        textBody: text,
      });
      log.info('Overdue alert sent', { to: inv.clientEmail, invoiceNumber: inv.invoiceNumber });
    } catch (err) {
      emailStatus = 'Failed';
      log.error('Failed to send overdue alert', { invoiceNumber: inv.invoiceNumber, err });
    }

    try {
      await logNotification({
        userId: inv.userId,
        type: 'OverdueAlert',
        recipientEmail: inv.clientEmail,
        invoiceNumber: inv.invoiceNumber,
        jobId: inv.jobId,
        status: emailStatus,
      });
    } catch (err) {
      log.error('Failed to log notification', { invoiceNumber: inv.invoiceNumber, err });
    }
  }
}

async function handleInvoiceReminder(log: Logger): Promise<void> {
  const today = todayIso();
  const inSevenDays = daysFromNow(7);
  const invoices = await queryAllGsi(
    'INV_STATUS#Sent',
    'GSI2SK BETWEEN :today AND :limit',
    { ':today': today, ':limit': inSevenDays },
  );

  log.info('invoice-reminder: queried upcoming invoices', { count: invoices.length });

  for (const inv of invoices) {
    let emailStatus: 'Sent' | 'Failed' = 'Sent';
    const { html, text } = invoiceDueReminder({
      clientName: inv.clientName,
      businessName: FROM_EMAIL,
      invoiceNumber: inv.invoiceNumber,
      totalAmount: inv.totalAmount,
      dueDate: inv.GSI2SK,
    });
    try {
      await sendEmail({
        to: inv.clientEmail,
        from: FROM_EMAIL,
        subject: `Promemoria pagamento: ${inv.invoiceNumber}`,
        htmlBody: html,
        textBody: text,
      });
      log.info('Reminder sent', { to: inv.clientEmail, invoiceNumber: inv.invoiceNumber });
    } catch (err) {
      emailStatus = 'Failed';
      log.error('Failed to send reminder', { invoiceNumber: inv.invoiceNumber, err });
    }

    try {
      await logNotification({
        userId: inv.userId,
        type: 'InvoiceReminder',
        recipientEmail: inv.clientEmail,
        invoiceNumber: inv.invoiceNumber,
        jobId: inv.jobId,
        status: emailStatus,
      });
    } catch (err) {
      log.error('Failed to log notification', { invoiceNumber: inv.invoiceNumber, err });
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: { source: string }, context: Context): Promise<void> => {
  const log = createLogger('notification-sender', context.awsRequestId);
  log.info('notification-sender triggered', { source: event.source });

  if (event.source === 'overdue-alert') {
    await handleOverdueAlert(log);
  } else if (event.source === 'invoice-reminder') {
    await handleInvoiceReminder(log);
  } else {
    log.warn('Unknown event source', { source: event.source });
  }
};
