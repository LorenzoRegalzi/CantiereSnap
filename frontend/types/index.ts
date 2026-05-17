export type JobStatus = 'Quote' | 'Accepted' | 'InProgress' | 'Completed' | 'Invoiced';

export interface Job {
  jobId: string;
  jobIdFormatted: string;
  clientId: string;
  clientName: string;
  description: string;
  address: string;
  targetDate: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  street: string;
  city: string;
  province: string;
  cap: string;
  country: string;
}

export interface Client {
  clientId: string;
  clientName: string;
  email: string;
  phone: string | null;
  codiceFiscale: string;
  partitaIva: string | null;
  address: Address;
  createdAt: string;
}

export interface StatusTransition {
  fromStatus: string;
  toStatus: string;
  changedAt: string;
}

export interface QuoteItem {
  seq: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface Quote {
  jobId: string;
  status: 'Draft' | 'Finalized';
  items: QuoteItem[];
  totalAmount: number;
  generatedAt?: string;
  finalizedAt?: string;
  pdfUrl?: string;
}

export interface Invoice {
  jobId: string;
  invoiceNumber: string;
  clientData: object;
  lineItems: object[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  status: 'Sent' | 'Paid' | 'Overdue';
  xmlUrl?: string;
  createdAt: string;
}

export interface Photo {
  photoId: string;
  jobId: string;
  tag: 'before' | 'after' | 'progress';
  s3Key: string;
  downloadUrl?: string;
  aiDescription?: string;
  createdAt: string;
}

export interface Material {
  materialId: string;
  jobId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  confidence: number;
  source: 'ocr' | 'manual';
  warning?: string;
}

export interface JobDetails extends Job {
  statusHistory: StatusTransition[];
  quote: Quote | null;
  photos: Photo[];
  materials: Material[];
  invoice: Invoice | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextToken?: string;
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}

export interface DashboardAnalytics {
  monthlyRevenue: number;
  jobCompletionRate: number;
  avgQuoteToInvoiceDays: number;
  materialsCostBreakdown: Record<string, number>;
  totalJobs: number;
  totalInvoices: number;
}
