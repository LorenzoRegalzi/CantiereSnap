// FatturaPA v1.2 XML skeleton — SDI-compatible structure (transmission not included)

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const fmt = (n: number): string => n.toFixed(2);

interface Address {
  street: string;
  city: string;
  province: string;
  cap: string;
  country: string;
}

interface LineItem {
  seq: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface FatturaPAParams {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  notes?: string;
  cedente: {
    partitaIvaCode: string; // digits only, no 'IT' prefix
    codiceFiscale: string;
    name: string;
    regimeFiscale: string;
    address: Address;
  };
  cessionario: {
    codiceFiscale: string;
    name: string;
    address: Address;
  };
  items: LineItem[];
  imponibile: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
}

export function buildFatturaPA(p: FatturaPAParams): string {
  const dettaglioLinee = p.items
    .map(
      (item) => `
    <DettaglioLinee>
      <NumeroLinea>${item.seq}</NumeroLinea>
      <Descrizione>${esc(item.description)}</Descrizione>
      <Quantita>${fmt(item.quantity)}</Quantita>
      <UnitaMisura>${esc(item.unit)}</UnitaMisura>
      <PrezzoUnitario>${fmt(item.unitPrice)}</PrezzoUnitario>
      <AliquotaIVA>${fmt(p.vatRate)}</AliquotaIVA>
      <PrezzoTotale>${fmt(item.lineTotal)}</PrezzoTotale>
    </DettaglioLinee>`,
    )
    .join('');

  const causale = p.notes ? `\n      <Causale>${esc(p.notes)}</Causale>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${esc(p.cedente.partitaIvaCode)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>1</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${esc(p.cedente.partitaIvaCode)}</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>${esc(p.cedente.codiceFiscale)}</CodiceFiscale>
        <Anagrafica>
          <Nome>${esc(p.cedente.name)}</Nome>
        </Anagrafica>
        <RegimeFiscale>${esc(p.cedente.regimeFiscale)}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${esc(p.cedente.address.street)}</Indirizzo>
        <CAP>${esc(p.cedente.address.cap)}</CAP>
        <Comune>${esc(p.cedente.address.city)}</Comune>
        <Provincia>${esc(p.cedente.address.province)}</Provincia>
        <Nazione>${esc(p.cedente.address.country)}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>${esc(p.cessionario.codiceFiscale)}</CodiceFiscale>
        <Anagrafica>
          <Nome>${esc(p.cessionario.name)}</Nome>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${esc(p.cessionario.address.street)}</Indirizzo>
        <CAP>${esc(p.cessionario.address.cap)}</CAP>
        <Comune>${esc(p.cessionario.address.city)}</Comune>
        <Provincia>${esc(p.cessionario.address.province)}</Provincia>
        <Nazione>${esc(p.cessionario.address.country)}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${p.invoiceDate}</Data>
        <Numero>${esc(p.invoiceNumber)}</Numero>
        <ImportoTotaleDocumento>${fmt(p.totalAmount)}</ImportoTotaleDocumento>${causale}
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>${dettaglioLinee}
      <DatiRiepilogo>
        <AliquotaIVA>${fmt(p.vatRate)}</AliquotaIVA>
        <ImponibileImporto>${fmt(p.imponibile)}</ImponibileImporto>
        <Imposta>${fmt(p.vatAmount)}</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataScadenzaPagamento>${p.dueDate}</DataScadenzaPagamento>
        <ImportoPagamento>${fmt(p.totalAmount)}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}
