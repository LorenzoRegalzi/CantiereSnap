import {
  quoteEmail,
  invoiceEmail,
  overdueEmail,
  invoiceDueReminder,
} from '../email-templates';

const QUOTE_PARAMS = {
  clientName: 'Luigi Bianchi',
  businessName: 'Rossi Impianti',
  jobDescription: 'Rifacimento impianto idraulico',
  quoteNumber: 'PREV-001',
  totalAmount: 4500,
  pdfUrl: 'https://example.com/quote.pdf',
};

const INVOICE_PARAMS = {
  clientName: 'Luigi Bianchi',
  businessName: 'Rossi Impianti',
  invoiceNumber: '2026/001',
  totalNet: 3688.52,
  vatRate: 22,
  vatAmount: 811.47,
  totalAmount: 4500,
  dueDate: '2026-06-10',
};

const OVERDUE_PARAMS = {
  clientName: 'Luigi Bianchi',
  businessName: 'Rossi Impianti',
  invoiceNumber: '2026/001',
  totalAmount: 4500,
  dueDate: '2026-05-01',
};

const REMINDER_PARAMS = {
  clientName: 'Luigi Bianchi',
  businessName: 'Rossi Impianti',
  invoiceNumber: '2026/002',
  totalAmount: 1200.5,
  dueDate: '2026-05-18',
};

// ── quoteEmail ────────────────────────────────────────────────────────────────

describe('quoteEmail', () => {
  it('returns both html and text', () => {
    const { html, text } = quoteEmail(QUOTE_PARAMS);
    expect(typeof html).toBe('string');
    expect(typeof text).toBe('string');
  });

  it('html contains invoice number and client name', () => {
    const { html } = quoteEmail(QUOTE_PARAMS);
    expect(html).toContain('PREV-001');
    expect(html).toContain('Luigi Bianchi');
  });

  it('html contains formatted total amount', () => {
    const { html } = quoteEmail(QUOTE_PARAMS);
    expect(html).toContain('4500.00');
  });

  it('html contains the PDF download link', () => {
    const { html } = quoteEmail(QUOTE_PARAMS);
    expect(html).toContain('https://example.com/quote.pdf');
  });

  it('html is a complete HTML document', () => {
    const { html } = quoteEmail(QUOTE_PARAMS);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('text contains key fields', () => {
    const { text } = quoteEmail(QUOTE_PARAMS);
    expect(text).toContain('PREV-001');
    expect(text).toContain('4500.00');
    expect(text).toContain('https://example.com/quote.pdf');
  });

  it('html contains CantiereSnap header', () => {
    const { html } = quoteEmail(QUOTE_PARAMS);
    expect(html).toContain('CantiereSnap');
  });
});

// ── invoiceEmail ──────────────────────────────────────────────────────────────

describe('invoiceEmail', () => {
  it('returns both html and text', () => {
    const { html, text } = invoiceEmail(INVOICE_PARAMS);
    expect(typeof html).toBe('string');
    expect(typeof text).toBe('string');
  });

  it('html shows net, VAT rate, VAT amount, and total', () => {
    const { html } = invoiceEmail(INVOICE_PARAMS);
    expect(html).toContain('3688.52');
    expect(html).toContain('22%');
    expect(html).toContain('811.47');
    expect(html).toContain('4500.00');
  });

  it('html contains due date', () => {
    const { html } = invoiceEmail(INVOICE_PARAMS);
    expect(html).toContain('2026-06-10');
  });

  it('html contains invoice number', () => {
    const { html } = invoiceEmail(INVOICE_PARAMS);
    expect(html).toContain('2026/001');
  });

  it('text summarises all amounts', () => {
    const { text } = invoiceEmail(INVOICE_PARAMS);
    expect(text).toContain('3688.52');
    expect(text).toContain('811.47');
    expect(text).toContain('4500.00');
    expect(text).toContain('2026-06-10');
  });
});

// ── overdueEmail ──────────────────────────────────────────────────────────────

describe('overdueEmail', () => {
  it('returns both html and text', () => {
    const { html, text } = overdueEmail(OVERDUE_PARAMS);
    expect(typeof html).toBe('string');
    expect(typeof text).toBe('string');
  });

  it('html contains alert styling (alert-box class)', () => {
    const { html } = overdueEmail(OVERDUE_PARAMS);
    expect(html).toContain('alert-box');
  });

  it('html contains invoice number, amount, and due date', () => {
    const { html } = overdueEmail(OVERDUE_PARAMS);
    expect(html).toContain('2026/001');
    expect(html).toContain('4500.00');
    expect(html).toContain('2026-05-01');
  });

  it('text contains SOLLECITO keyword', () => {
    const { text } = overdueEmail(OVERDUE_PARAMS);
    expect(text).toContain('SOLLECITO');
  });

  it('text contains all key fields', () => {
    const { text } = overdueEmail(OVERDUE_PARAMS);
    expect(text).toContain('2026/001');
    expect(text).toContain('4500.00');
    expect(text).toContain('2026-05-01');
  });
});

// ── invoiceDueReminder ────────────────────────────────────────────────────────

describe('invoiceDueReminder', () => {
  it('returns both html and text', () => {
    const { html, text } = invoiceDueReminder(REMINDER_PARAMS);
    expect(typeof html).toBe('string');
    expect(typeof text).toBe('string');
  });

  it('html contains info-box styling (not alert-box)', () => {
    const { html } = invoiceDueReminder(REMINDER_PARAMS);
    expect(html).toContain('info-box');
    expect(html).not.toContain('alert-box');
  });

  it('html contains invoice number, amount, and due date', () => {
    const { html } = invoiceDueReminder(REMINDER_PARAMS);
    expect(html).toContain('2026/002');
    expect(html).toContain('1200.50');
    expect(html).toContain('2026-05-18');
  });

  it('text mentions 7-day reminder', () => {
    const { text } = invoiceDueReminder(REMINDER_PARAMS);
    expect(text).toContain('7');
  });

  it('text contains all key fields', () => {
    const { text } = invoiceDueReminder(REMINDER_PARAMS);
    expect(text).toContain('2026/002');
    expect(text).toContain('1200.50');
    expect(text).toContain('2026-05-18');
  });
});
