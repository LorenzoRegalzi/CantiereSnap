export interface Job {
  jobId: string;
  clientId: string;
  title: string;
  description: string;
  status: 'Quote' | 'Accepted' | 'InProgress' | 'Completed' | 'Invoiced';
  address?: string;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  clientId: string;
  fullName: string;
  email?: string;
  phone?: string;
  fiscalCode?: string;
  address?: string;
  createdAt: string;
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
