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
  jobId?: string;
  status: 'Draft' | 'Approved' | 'Sent' | 'processing' | 'failed';
  totalAmount: number;
  currency?: string;
  generationTimeMs?: number;
  inputLength?: number;
  itemCount: number;
  model?: string;
  pdfS3Key?: string | null;
  pdfUrl?: string;
  sentAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuoteGenerateResponse {
  quote: Quote;
  items: QuoteItem[];
}

export interface QuoteFinalizeResponse {
  pdfUrl: string;
  status: string;
  totalAmount: number;
  itemCount: number;
}

export interface Invoice {
  invoiceNumber: string;
  jobId: string;
  clientName: string;
  totalAmount: number;
  vatAmount: number;
  vatRate: number;
  currency?: string;
  status: 'Draft' | 'Sent' | 'Paid' | 'Overdue';
  dueDate: string;
  paymentTerms: string;
  xmlUrl?: string;
  paidAt?: string;
  createdAt: string;
  items: QuoteItem[];
}

export interface Profile {
  fullName: string;
  email: string;
  businessName?: string;
  partitaIva?: string;
  codiceFiscale?: string;
  regimeFiscale?: string;
  phone?: string;
  address?: Address;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  photoId: string;
  tag: 'Before' | 'After';
  mimeType: string;
  sizeBytes: number | null;
  imageUrl: string;
  aiDescription: string | null;
  aiDescriptionEdited: boolean;
  uploadedAt: string;
}

export interface Material {
  materialId: string;
  itemName: string;
  quantity: number;
  cost: number;
  confidence: number;
  verified: boolean;
  warning?: string;
  createdAt: string;
}

export interface MaterialsResponse {
  items: Material[];
  totalCost: number;
}

export interface JobDetails extends Job {
  statusHistory: StatusTransition[];
  quote: Quote | null;
  photos: Photo[];
  materials: Material[];
  materialsTotalCost?: number;
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

export interface DashboardSummary {
  month: string;
  monthlyRevenue: number;
  completionRate: number;
  overdueInvoices: number;
  avgQuoteToInvoiceDays: number | null;
  totalJobs: number;
  completedJobs: number;
}

export interface RevenueData {
  startDate: string;
  endDate: string;
  months: { month: string; revenue: number }[];
  total: number;
}

export interface JobsStats {
  total: number;
  byStatus: Record<string, number>;
}
