// ── Shared styles ─────────────────────────────────────────────────────────────

const BASE_STYLES = `
  body { margin:0; padding:0; background:#f4f4f5; font-family:Arial,Helvetica,sans-serif; }
  .wrapper { max-width:600px; margin:0 auto; background:#ffffff; }
  .header { background:#1f2937; padding:28px 32px; }
  .header-title { color:#ffffff; font-size:22px; font-weight:bold; margin:0; letter-spacing:0.5px; }
  .header-sub { color:#9ca3af; font-size:13px; margin:4px 0 0 0; }
  .body { padding:32px; color:#374151; font-size:15px; line-height:1.6; }
  .section-title { font-size:13px; font-weight:bold; color:#6b7280; text-transform:uppercase;
    letter-spacing:0.8px; margin:0 0 12px 0; border-bottom:1px solid #e5e7eb; padding-bottom:8px; }
  table.items { width:100%; border-collapse:collapse; margin:0 0 24px 0; }
  table.items th { background:#f9fafb; padding:8px 12px; text-align:left; font-size:13px;
    color:#6b7280; font-weight:600; border-bottom:2px solid #e5e7eb; }
  table.items td { padding:10px 12px; font-size:14px; border-bottom:1px solid #f3f4f6; }
  .amount-row td { font-weight:bold; background:#f9fafb; border-top:2px solid #e5e7eb; }
  .cta-wrap { text-align:center; margin:28px 0; }
  .cta { display:inline-block; background:#1f2937; color:#ffffff; text-decoration:none;
    padding:12px 28px; border-radius:6px; font-size:15px; font-weight:bold; }
  .alert-box { background:#fef2f2; border:1px solid #fecaca; border-radius:6px;
    padding:16px 20px; margin:0 0 24px 0; color:#b91c1c; font-weight:600; font-size:14px; }
  .info-box { background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px;
    padding:16px 20px; margin:0 0 24px 0; color:#1e40af; font-size:14px; }
  .footer { background:#f9fafb; padding:20px 32px; text-align:center; color:#9ca3af;
    font-size:12px; border-top:1px solid #e5e7eb; }
`.replace(/\s+/g, ' ').trim();

function wrap(headerSub: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><style>${BASE_STYLES}</style></head>
<body>
<div class="wrapper">
  <div class="header">
    <p class="header-title">CantiereSnap</p>
    <p class="header-sub">${headerSub}</p>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">CantiereSnap &mdash; Gestione cantieri semplificata<br>
    Questa è un'email automatica, non rispondere direttamente.
  </div>
</div>
</body></html>`;
}

// ── Template 1: Quote PDF email (sent to client when quote is shared) ─────────

export interface QuoteEmailParams {
  clientName: string;
  businessName: string;
  jobDescription: string;
  quoteNumber: string;
  totalAmount: number;
  pdfUrl: string;
}

export function quoteEmail(p: QuoteEmailParams): { html: string; text: string } {
  const html = wrap('Preventivo', `
    <p>Gentile <strong>${p.clientName}</strong>,</p>
    <p>${p.businessName} le invia il preventivo relativo ai lavori:</p>
    <p class="section-title">Dettagli preventivo</p>
    <table class="items">
      <tr>
        <th>Rif. preventivo</th>
        <th>Descrizione</th>
        <th style="text-align:right">Importo totale</th>
      </tr>
      <tr>
        <td>${p.quoteNumber}</td>
        <td>${p.jobDescription}</td>
        <td style="text-align:right"><strong>&euro;${p.totalAmount.toFixed(2)}</strong></td>
      </tr>
    </table>
    <div class="cta-wrap">
      <a class="cta" href="${p.pdfUrl}">Scarica il preventivo PDF</a>
    </div>
    <p style="font-size:13px;color:#6b7280;">Il link è valido per 1 ora. Per qualsiasi domanda non esiti a contattarci.</p>
    <p>Cordiali saluti,<br><strong>${p.businessName}</strong></p>
  `);

  const text =
    `Gentile ${p.clientName},\n\n` +
    `${p.businessName} le invia il preventivo n. ${p.quoteNumber}.\n` +
    `Lavori: ${p.jobDescription}\n` +
    `Importo totale: €${p.totalAmount.toFixed(2)}\n\n` +
    `Scarica il PDF: ${p.pdfUrl}\n\n` +
    `Cordiali saluti,\n${p.businessName}`;

  return { html, text };
}

// ── Template 2: Invoice email (sent to client with FatturaPA reference) ───────

export interface InvoiceEmailParams {
  clientName: string;
  businessName: string;
  invoiceNumber: string;
  totalNet: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  dueDate: string;
}

export function invoiceEmail(p: InvoiceEmailParams): { html: string; text: string } {
  const html = wrap('Fattura', `
    <p>Gentile <strong>${p.clientName}</strong>,</p>
    <p>Le trasmettiamo la fattura n. <strong>${p.invoiceNumber}</strong> emessa da <strong>${p.businessName}</strong>.</p>
    <p class="section-title">Riepilogo importi</p>
    <table class="items">
      <tr><th>Voce</th><th style="text-align:right">Importo</th></tr>
      <tr><td>Imponibile</td><td style="text-align:right">&euro;${p.totalNet.toFixed(2)}</td></tr>
      <tr><td>IVA (${p.vatRate}%)</td><td style="text-align:right">&euro;${p.vatAmount.toFixed(2)}</td></tr>
      <tr class="amount-row">
        <td>Totale fattura</td>
        <td style="text-align:right">&euro;${p.totalAmount.toFixed(2)}</td>
      </tr>
    </table>
    <div class="info-box">
      Scadenza pagamento: <strong>${p.dueDate}</strong>
    </div>
    <p>La fattura elettronica (FatturaPA) è stata trasmessa al Sistema di Interscambio.</p>
    <p>Cordiali saluti,<br><strong>${p.businessName}</strong></p>
  `);

  const text =
    `Gentile ${p.clientName},\n\n` +
    `Fattura n. ${p.invoiceNumber} da ${p.businessName}.\n\n` +
    `Imponibile: €${p.totalNet.toFixed(2)}\n` +
    `IVA (${p.vatRate}%): €${p.vatAmount.toFixed(2)}\n` +
    `Totale: €${p.totalAmount.toFixed(2)}\n` +
    `Scadenza: ${p.dueDate}\n\n` +
    `Cordiali saluti,\n${p.businessName}`;

  return { html, text };
}

// ── Template 3: Overdue reminder (sent to client when invoice is overdue) ─────

export interface OverdueEmailParams {
  clientName: string;
  businessName: string;
  invoiceNumber: string;
  totalAmount: number;
  dueDate: string;
}

export function overdueEmail(p: OverdueEmailParams): { html: string; text: string } {
  const html = wrap('Sollecito di pagamento', `
    <p>Gentile <strong>${p.clientName}</strong>,</p>
    <div class="alert-box">
      &#9888;&nbsp; La fattura n. <strong>${p.invoiceNumber}</strong> risulta <strong>scaduta e non saldata</strong>.
    </div>
    <p class="section-title">Dettagli fattura scaduta</p>
    <table class="items">
      <tr><th>N. fattura</th><th>Scadenza</th><th style="text-align:right">Importo</th></tr>
      <tr>
        <td>${p.invoiceNumber}</td>
        <td>${p.dueDate}</td>
        <td style="text-align:right"><strong>&euro;${p.totalAmount.toFixed(2)}</strong></td>
      </tr>
    </table>
    <p>La invitiamo a provvedere al pagamento nel più breve tempo possibile.</p>
    <p>Per qualsiasi informazione non esiti a contattare <strong>${p.businessName}</strong>.</p>
    <p>Cordiali saluti,<br><strong>${p.businessName}</strong></p>
  `);

  const text =
    `Gentile ${p.clientName},\n\n` +
    `SOLLECITO: La fattura n. ${p.invoiceNumber} di €${p.totalAmount.toFixed(2)} ` +
    `con scadenza ${p.dueDate} risulta scaduta e non saldata.\n\n` +
    `La invitiamo a provvedere al pagamento nel più breve tempo possibile.\n\n` +
    `Cordiali saluti,\n${p.businessName}`;

  return { html, text };
}

// ── Template 4: Invoice due reminder (sent 7 days before due date) ────────────

export interface InvoiceDueReminderParams {
  clientName: string;
  businessName: string;
  invoiceNumber: string;
  totalAmount: number;
  dueDate: string;
}

export function invoiceDueReminder(p: InvoiceDueReminderParams): { html: string; text: string } {
  const html = wrap('Promemoria scadenza fattura', `
    <p>Gentile <strong>${p.clientName}</strong>,</p>
    <div class="info-box">
      La fattura n. <strong>${p.invoiceNumber}</strong> ha scadenza il <strong>${p.dueDate}</strong>.
    </div>
    <p class="section-title">Dettagli fattura</p>
    <table class="items">
      <tr><th>N. fattura</th><th>Scadenza</th><th style="text-align:right">Importo</th></tr>
      <tr>
        <td>${p.invoiceNumber}</td>
        <td>${p.dueDate}</td>
        <td style="text-align:right"><strong>&euro;${p.totalAmount.toFixed(2)}</strong></td>
      </tr>
    </table>
    <p>Mancano 7 giorni alla scadenza. Le ricordiamo di provvedere al pagamento entro la data indicata.</p>
    <p>Per qualsiasi informazione non esiti a contattare <strong>${p.businessName}</strong>.</p>
    <p>Cordiali saluti,<br><strong>${p.businessName}</strong></p>
  `);

  const text =
    `Gentile ${p.clientName},\n\n` +
    `Promemoria: la fattura n. ${p.invoiceNumber} di €${p.totalAmount.toFixed(2)} ` +
    `ha scadenza il ${p.dueDate}.\n\n` +
    `Mancano 7 giorni alla scadenza. La invitiamo a provvedere al pagamento in tempo.\n\n` +
    `Cordiali saluti,\n${p.businessName}`;

  return { html, text };
}
