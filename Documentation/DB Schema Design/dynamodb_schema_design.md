# CantiereSnap — DynamoDB Single-Table Schema Design

| | |
|---|---|
| **Version** | 1.0 |
| **Date** | 27 April 2026 |
| **Author** | Lorenzo Regalzi |
| **Supervisor** | Prof. Lokesh Vij |
| **Program** | OPIT — BSc Modern Computer Science |
| **Status** | Draft |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 27 Apr 2026 | Lorenzo Regalzi | Initial draft |
| 1.1 | 27 Apr 2026 | Lorenzo Regalzi | Added: entityType discriminator pattern, transaction patterns (Sec. 10), SMS target date query strategy, full-text search limitations, GSI hot partition and eventual consistency notes (Sec. 11) |

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Table Definition](#2-table-definition)
3. [Entity Key Design](#3-entity-key-design)
4. [Global Secondary Indexes](#4-global-secondary-indexes)
5. [Access Patterns](#5-access-patterns)
6. [Entity Attribute Definitions](#6-entity-attribute-definitions)
7. [Sample Items](#7-sample-items)
8. [S3 Key Structure](#8-s3-key-structure)
9. [Capacity and Cost Model](#9-capacity-and-cost-model)
10. [Transaction Patterns](#10-transaction-patterns)
11. [Known Limitations and Future Considerations](#11-known-limitations-and-future-considerations)

---

## 1. Design Principles

CantiereSnap stores all entities in a single DynamoDB table. This eliminates cross-table joins, reduces operational overhead, and keeps the Free Tier footprint minimal — a direct response to NFR-COST-001.

Three design decisions shape the schema:

**User-scoped partitions.** Every item includes the user ID in its partition key. A tradesperson's data is physically co-located, which optimises read performance for the Kanban board and dashboard queries. This also enforces data isolation at the key level (NFR-SEC-004) — no query can accidentally return another user's records.

**Job collection pattern.** Each job acts as an aggregate root. The job header lives in the user partition (`PK = USER#<userId>`, `SK = JOB#<jobId>`), while all child entities — quote, quote items, photos, materials, invoice, invoice items, and status history — share a separate partition (`PK = JOB#<userId>#<jobId>`). A single Query on that partition retrieves everything related to a job in one round trip.

**Overloaded GSIs.** Two Global Secondary Indexes handle all secondary access patterns. Different entity types project different values into the same GSI, enabling status-based filtering (Kanban, invoice tracking) and date-based queries (EventBridge notifications, dashboard analytics) without additional indexes.

**Entity type discriminator.** Every item carries an `entityType` attribute (e.g., `Job`, `Quote`, `Photo`). When the application queries a job partition (`PK = JOB#<userId>#<jobId>`) with no SK filter, the result set contains a mix of quotes, photos, materials, invoices, and status history entries. The `entityType` field lets the application-layer code group and route items to the correct data model without parsing the sort key. It also simplifies debugging — a Scan or export of the table is immediately readable without a key-decoding reference.

---

## 2. Table Definition

| Property | Value |
|----------|-------|
| Table name | `CantiereSnapTable` |
| Partition key | `PK` (String) |
| Sort key | `SK` (String) |
| Billing mode | PAY_PER_REQUEST (on-demand) |
| Encryption | AWS-managed (SSE-S3) |
| Point-in-time recovery | Enabled |
| TTL attribute | `ttl` (used for notification logs, 90-day expiry) |

---

## 3. Entity Key Design

The table holds 13 entity types across two partition strategies: the **user partition** (for top-level entities and listings) and the **job partition** (for job-scoped child entities).

### 3.1 User Partition

These entities live under `PK = USER#<userId>` and support listing, filtering, and dashboard operations.

| Entity | PK | SK | Purpose |
|--------|-----|-----|---------|
| User Profile | `USER#<userId>` | `PROFILE` | Tradesperson account and fiscal data |
| Client | `USER#<userId>` | `CLIENT#<clientId>` | Client registry |
| Job (header) | `USER#<userId>` | `JOB#<jobId>` | Job summary for Kanban listing |
| Job Counter | `USER#<userId>` | `COUNTER#JOB` | Atomic counter for sequential job IDs (FR-JOB-002) |
| Notification Log | `USER#<userId>` | `NOTIFY#<timestamp>` | Record of sent reminders and alerts |
| Monthly Analytics | `USER#<userId>` | `ANALYTICS#<YYYY-MM>` | Pre-aggregated dashboard metrics (FR-DASH-001 to FR-DASH-004) |

**Listing jobs:** Query `PK = USER#<userId>` with `SK begins_with JOB#` returns all job headers for the Kanban board. No child entities are mixed in because they live in the job partition.

**Sequential job IDs:** The `COUNTER#JOB` item stores a `lastJobId` attribute. Each new job uses `UpdateItem` with `ADD lastJobId 1` to atomically increment and return the next ID. This guarantees unique, sequential IDs per tradesperson.

### 3.2 Job Partition

These entities live under `PK = JOB#<userId>#<jobId>` and represent everything attached to a single job.

| Entity | PK | SK | Purpose |
|--------|-----|-----|---------|
| Status History | `JOB#<userId>#<jobId>` | `STATUS#<timestamp>` | Timestamped status transitions (FR-JOB-004) |
| Quote | `JOB#<userId>#<jobId>` | `QUOTE` | Quote metadata (total, creation date, PDF S3 key) |
| Quote Item | `JOB#<userId>#<jobId>` | `QUOTE#ITEM#<seq>` | Individual line items (FR-QUOTE-002, FR-QUOTE-004) |
| Photo | `JOB#<userId>#<jobId>` | `PHOTO#<photoId>` | Photo metadata and AI description (FR-PHOTO-001 to FR-PHOTO-005) |
| Material | `JOB#<userId>#<jobId>` | `MATERIAL#<materialId>` | OCR-extracted cost entries (FR-OCR-001 to FR-OCR-003) |
| Invoice | `JOB#<userId>#<jobId>` | `INVOICE` | Invoice metadata and FatturaPA XML S3 key |
| Invoice Item | `JOB#<userId>#<jobId>` | `INVOICE#ITEM#<seq>` | Invoice line items |

**Loading a job detail page:** Query `PK = JOB#<userId>#<jobId>` with no SK filter returns every child entity in a single request. The application groups items by their SK prefix to populate the UI sections (quote, photos, materials, invoice, status timeline).

---

## 4. Global Secondary Indexes

### 4.1 GSI-1: StatusIndex

Supports Kanban filtering by job status and invoice tracking by payment status.

| Property | Value |
|----------|-------|
| Index name | `StatusIndex` |
| Partition key | `GSI1PK` (String) |
| Sort key | `GSI1SK` (String) |
| Projection | ALL |

**Entity projections into GSI-1:**

| Entity | GSI1PK | GSI1SK | Query Use Case |
|--------|--------|--------|----------------|
| Job | `USER#<userId>` | `JOB#<status>#<createdAt>` | Filter jobs by status (FR-JOB-005, FR-JOB-006) |
| Invoice | `USER#<userId>` | `INV#<status>#<createdAt>` | Filter invoices by status (FR-INV-004, FR-DASH-005) |
| Client | `USER#<userId>` | `CLIENT#<clientName>` | Search clients by name |

**Query examples:**

- All jobs for a user: `GSI1PK = USER#<userId>`, `GSI1SK begins_with JOB#`
- Only "In Progress" jobs: `GSI1PK = USER#<userId>`, `GSI1SK begins_with JOB#InProgress#`
- Overdue invoices: `GSI1PK = USER#<userId>`, `GSI1SK begins_with INV#Overdue#`
- Client name search: `GSI1PK = USER#<userId>`, `GSI1SK begins_with CLIENT#Mar` (finds "Marchetti", "Marino", etc.)

### 4.2 GSI-2: DueDateIndex

Supports cross-user queries for the EventBridge notification Lambdas (FR-NOTIFY-001, FR-NOTIFY-002). The partition key is deliberately not user-scoped — the daily invoice reminder Lambda needs to scan all invoices due within a date range, regardless of which tradesperson owns them.

| Property | Value |
|----------|-------|
| Index name | `DueDateIndex` |
| Partition key | `GSI2PK` (String) |
| Sort key | `GSI2SK` (String) |
| Projection | INCLUDE (`userId`, `jobId`, `clientName`, `clientEmail`, `invoiceNumber`, `totalAmount`) |

**Entity projections into GSI-2:**

| Entity | GSI2PK | GSI2SK | Query Use Case |
|--------|--------|--------|----------------|
| Invoice | `INV_STATUS#<status>` | `<dueDate>` | Find all invoices by status and due date range |
| Job | `USER_JOBS#<userId>` | `<createdAt>` | Date-range queries for dashboard (FR-DASH-006) |

**Query examples:**

- Invoices due within 7 days (reminder Lambda): `GSI2PK = INV_STATUS#Sent`, `GSI2SK BETWEEN 2026-04-27 AND 2026-05-04`
- Overdue invoices (overdue Lambda): `GSI2PK = INV_STATUS#Sent`, `GSI2SK < 2026-04-27`
- Jobs created in a date range (dashboard): `GSI2PK = USER_JOBS#<userId>`, `GSI2SK BETWEEN 2026-01-01 AND 2026-03-31`

**SMS appointment reminders (FR-NOTIFY-003).** This "Could" priority feature requires querying jobs by `targetDate` across users. Since each item can only project one value pair into GSI-2, and the Job entity already uses GSI-2 for dashboard date-range queries, SMS reminders use a different strategy: the daily EventBridge Lambda queries each user's jobs from the main table (`PK = USER#<userId>`, `SK begins_with JOB#`) with a `FilterExpression` on `targetDate`. At the expected scale (fewer than 30 active jobs per tradesperson), this filter adds negligible cost and latency. If the feature is promoted to "Must" priority, a dedicated GSI-3 (`GSI3PK = JOB_TARGET_DATE`, `GSI3SK = <targetDate>`) enables a single cross-user query.

---

## 5. Access Patterns

The table maps all access patterns from the SRS functional requirements. Each pattern is listed with its DynamoDB operation, key condition, and the requirement it satisfies.

### 5.1 User and Client Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-01 | Get user profile | `GetItem` | Table | `PK = USER#<userId>`, `SK = PROFILE` | FR-AUTH-003 |
| AP-02 | Update user fiscal data | `UpdateItem` | Table | `PK = USER#<userId>`, `SK = PROFILE` | FR-INV-001 |
| AP-03 | List all clients | `Query` | Table | `PK = USER#<userId>`, `SK begins_with CLIENT#` | FR-JOB-001 |
| AP-04 | Search client by name | `Query` | GSI-1 | `GSI1PK = USER#<userId>`, `GSI1SK begins_with CLIENT#<name>` | FR-JOB-006 |
| AP-05 | Create / update client | `PutItem` | Table | `PK = USER#<userId>`, `SK = CLIENT#<clientId>` | FR-JOB-001 |

### 5.2 Job Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-06 | Get next job ID | `UpdateItem` (ADD) | Table | `PK = USER#<userId>`, `SK = COUNTER#JOB` | FR-JOB-002 |
| AP-07 | Create job | `PutItem` | Table | `PK = USER#<userId>`, `SK = JOB#<jobId>` | FR-JOB-001 |
| AP-08 | Get job by ID | `GetItem` | Table | `PK = USER#<userId>`, `SK = JOB#<jobId>` | FR-JOB-001 |
| AP-09 | List all jobs (Kanban) | `Query` | Table | `PK = USER#<userId>`, `SK begins_with JOB#` | FR-JOB-005 |
| AP-10 | Filter jobs by status | `Query` | GSI-1 | `GSI1PK = USER#<userId>`, `GSI1SK begins_with JOB#<status>#` | FR-JOB-006 |
| AP-11 | Update job status | `UpdateItem` | Table | `PK = USER#<userId>`, `SK = JOB#<jobId>` | FR-JOB-003 |
| AP-12 | Record status transition | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = STATUS#<timestamp>` | FR-JOB-004 |
| AP-13 | Get job status history | `Query` | Table | `PK = JOB#<userId>#<jobId>`, `SK begins_with STATUS#` | FR-JOB-004 |
| AP-14 | Get all job data (detail) | `Query` | Table | `PK = JOB#<userId>#<jobId>` | FR-JOB-001 |
| AP-15 | Jobs by date range | `Query` | GSI-2 | `GSI2PK = USER_JOBS#<userId>`, `GSI2SK BETWEEN <start> AND <end>` | FR-DASH-006 |

### 5.3 Quote Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-16 | Save quote metadata | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = QUOTE` | FR-QUOTE-001 |
| AP-17 | Save quote line item | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = QUOTE#ITEM#<seq>` | FR-QUOTE-002 |
| AP-18 | Get quote with items | `Query` | Table | `PK = JOB#<userId>#<jobId>`, `SK begins_with QUOTE` | FR-QUOTE-004 |
| AP-19 | Update quote line item | `UpdateItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = QUOTE#ITEM#<seq>` | FR-QUOTE-004 |
| AP-20 | Delete quote line item | `DeleteItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = QUOTE#ITEM#<seq>` | FR-QUOTE-004 |

### 5.4 Photo Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-21 | Save photo metadata | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = PHOTO#<photoId>` | FR-PHOTO-002 |
| AP-22 | List photos for job | `Query` | Table | `PK = JOB#<userId>#<jobId>`, `SK begins_with PHOTO#` | FR-PHOTO-001 |
| AP-23 | Update photo description | `UpdateItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = PHOTO#<photoId>` | FR-PHOTO-005 |

### 5.5 Material Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-24 | Save material entry | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = MATERIAL#<materialId>` | FR-OCR-002 |
| AP-25 | List materials for job | `Query` | Table | `PK = JOB#<userId>#<jobId>`, `SK begins_with MATERIAL#` | FR-OCR-003 |
| AP-26 | Update material entry | `UpdateItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = MATERIAL#<materialId>` | FR-OCR-003 |

### 5.6 Invoice Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-27 | Save invoice metadata | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = INVOICE` | FR-INV-001 |
| AP-28 | Save invoice line item | `PutItem` | Table | `PK = JOB#<userId>#<jobId>`, `SK = INVOICE#ITEM#<seq>` | FR-INV-001 |
| AP-29 | Get invoice with items | `Query` | Table | `PK = JOB#<userId>#<jobId>`, `SK begins_with INVOICE` | FR-INV-002 |
| AP-30 | Update invoice status | `UpdateItem` | Table + GSI-1 reindex | `PK = JOB#<userId>#<jobId>`, `SK = INVOICE` | FR-INV-004 |
| AP-31 | List invoices by status | `Query` | GSI-1 | `GSI1PK = USER#<userId>`, `GSI1SK begins_with INV#<status>#` | FR-INV-004 |
| AP-32 | Invoices due in 7 days | `Query` | GSI-2 | `GSI2PK = INV_STATUS#Sent`, `GSI2SK BETWEEN <today> AND <today+7>` | FR-NOTIFY-001 |
| AP-33 | Overdue invoices (all users) | `Query` | GSI-2 | `GSI2PK = INV_STATUS#Sent`, `GSI2SK < <today>` | FR-NOTIFY-002 |

### 5.7 Dashboard and Notification Operations

| # | Access Pattern | Operation | Key / Index | Condition | Req |
|---|---------------|-----------|-------------|-----------|-----|
| AP-34 | Get monthly analytics | `GetItem` | Table | `PK = USER#<userId>`, `SK = ANALYTICS#<YYYY-MM>` | FR-DASH-001 |
| AP-35 | Get analytics range | `Query` | Table | `PK = USER#<userId>`, `SK BETWEEN ANALYTICS#<start> AND ANALYTICS#<end>` | FR-DASH-006 |
| AP-36 | Store monthly aggregation | `PutItem` | Table | `PK = USER#<userId>`, `SK = ANALYTICS#<YYYY-MM>` | FR-DASH-001 |
| AP-37 | Log notification sent | `PutItem` | Table | `PK = USER#<userId>`, `SK = NOTIFY#<timestamp>` | FR-NOTIFY-001 |
| AP-38 | List recent notifications | `Query` | Table | `PK = USER#<userId>`, `SK begins_with NOTIFY#`, ScanIndexForward=false, Limit=20 | FR-NOTIFY-001 |
| AP-39 | Jobs with target date (SMS) | `Query` + `FilterExpression` | Table | `PK = USER#<userId>`, `SK begins_with JOB#`, filter `targetDate = :date` | FR-NOTIFY-003 |
| AP-40 | Search jobs by description | `Query` + `FilterExpression` | Table | `PK = USER#<userId>`, `SK begins_with JOB#`, filter `contains(description, :term)` | FR-JOB-006 |

---

## 6. Entity Attribute Definitions

### 6.1 User Profile

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `USER#<userId>` |
| `SK` | S | `PROFILE` |
| `entityType` | S | `UserProfile` |
| `email` | S | Tradesperson email (matches Cognito) |
| `fullName` | S | Full name |
| `businessName` | S | Business or trade name |
| `partitaIva` | S | Italian VAT number (Partita IVA) |
| `codiceFiscale` | S | Italian tax code |
| `regimeFiscale` | S | Tax regime code (e.g., `RF19` for *regime forfettario*) |
| `address` | M | `{ street, city, province, cap, country }` |
| `phone` | S | Phone number |
| `createdAt` | S | ISO 8601 timestamp |
| `updatedAt` | S | ISO 8601 timestamp |

### 6.2 Client

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `USER#<userId>` |
| `SK` | S | `CLIENT#<clientId>` |
| `GSI1PK` | S | `USER#<userId>` |
| `GSI1SK` | S | `CLIENT#<clientName>` (normalised, lowercase) |
| `entityType` | S | `Client` |
| `clientId` | S | ULID |
| `clientName` | S | Full name or business name |
| `email` | S | Client email |
| `phone` | S | Client phone |
| `codiceFiscale` | S | Client tax code (required for FatturaPA) |
| `partitaIva` | S | Client VAT number (if applicable) |
| `address` | M | `{ street, city, province, cap, country }` |
| `createdAt` | S | ISO 8601 timestamp |

### 6.3 Job

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `USER#<userId>` |
| `SK` | S | `JOB#<jobId>` (zero-padded, e.g., `JOB#00042`) |
| `GSI1PK` | S | `USER#<userId>` |
| `GSI1SK` | S | `JOB#<status>#<createdAt>` |
| `GSI2PK` | S | `USER_JOBS#<userId>` |
| `GSI2SK` | S | `<createdAt>` (ISO 8601) |
| `entityType` | S | `Job` |
| `jobId` | N | Sequential job number |
| `clientId` | S | Reference to client entity |
| `clientName` | S | Denormalised for display |
| `description` | S | Job description |
| `address` | S | Job site address |
| `targetDate` | S | Target completion date (ISO 8601) |
| `status` | S | `Quote` \| `Accepted` \| `InProgress` \| `Completed` \| `Invoiced` |
| `createdAt` | S | ISO 8601 timestamp |
| `updatedAt` | S | ISO 8601 timestamp |

### 6.4 Job Counter

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `USER#<userId>` |
| `SK` | S | `COUNTER#JOB` |
| `entityType` | S | `Counter` |
| `lastJobId` | N | Current highest job ID (atomically incremented) |

### 6.5 Job Status History

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `STATUS#<timestamp>` (ISO 8601) |
| `entityType` | S | `StatusTransition` |
| `fromStatus` | S | Previous status (null for initial creation) |
| `toStatus` | S | New status |
| `changedAt` | S | ISO 8601 timestamp |

### 6.6 Quote

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `QUOTE` |
| `entityType` | S | `Quote` |
| `totalAmount` | N | Sum of all line items |
| `currency` | S | `EUR` |
| `inputText` | S | Original natural-language description |
| `inputLength` | N | Character count of input (FR-QUOTE-006) |
| `generationTimeMs` | N | AI generation time in ms (FR-QUOTE-006) |
| `itemCount` | N | Number of generated line items (FR-QUOTE-006) |
| `pdfS3Key` | S | S3 key for generated PDF |
| `status` | S | `Draft` \| `Sent` \| `Approved` |
| `sentAt` | S | Timestamp when emailed to client |
| `createdAt` | S | ISO 8601 timestamp |
| `updatedAt` | S | ISO 8601 timestamp |

### 6.7 Quote Item

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `QUOTE#ITEM#<seq>` (zero-padded, e.g., `QUOTE#ITEM#001`) |
| `entityType` | S | `QuoteItem` |
| `seq` | N | Sequence number |
| `description` | S | Line item description |
| `quantity` | N | Quantity |
| `unit` | S | Unit of measure (e.g., `mq`, `ore`, `pz`) |
| `unitPrice` | N | Price per unit in EUR |
| `lineTotal` | N | `quantity × unitPrice` |

### 6.8 Photo

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `PHOTO#<photoId>` |
| `entityType` | S | `Photo` |
| `photoId` | S | ULID |
| `s3Key` | S | S3 object key |
| `tag` | S | `Before` \| `After` (FR-PHOTO-003) |
| `mimeType` | S | `image/jpeg` \| `image/png` |
| `sizeBytes` | N | File size |
| `aiDescription` | S | AI-generated technical description (FR-PHOTO-004) |
| `aiDescriptionEdited` | BOOL | Whether tradesperson modified the description |
| `uploadedAt` | S | ISO 8601 timestamp |

### 6.9 Material

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `MATERIAL#<materialId>` |
| `entityType` | S | `Material` |
| `materialId` | S | ULID |
| `itemName` | S | Material name |
| `quantity` | N | Quantity |
| `cost` | N | Cost in EUR |
| `confidence` | N | Textract confidence score (0–100) (FR-OCR-004) |
| `sourceS3Key` | S | S3 key of the receipt/note image |
| `verified` | BOOL | Whether tradesperson reviewed and confirmed |
| `createdAt` | S | ISO 8601 timestamp |

### 6.10 Invoice

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `INVOICE` |
| `GSI1PK` | S | `USER#<userId>` |
| `GSI1SK` | S | `INV#<status>#<createdAt>` |
| `GSI2PK` | S | `INV_STATUS#<status>` |
| `GSI2SK` | S | `<dueDate>` (ISO 8601 date) |
| `entityType` | S | `Invoice` |
| `invoiceNumber` | S | Progressive invoice number (e.g., `2026/001`) |
| `userId` | S | Tradesperson user ID (projected in GSI-2 for notifications) |
| `jobId` | S | Job reference |
| `clientName` | S | Denormalised for GSI-2 projection |
| `clientEmail` | S | Denormalised for GSI-2 projection |
| `totalAmount` | N | Invoice total including VAT |
| `vatAmount` | N | VAT amount |
| `vatRate` | N | VAT percentage (e.g., 22) |
| `currency` | S | `EUR` |
| `status` | S | `Draft` \| `Sent` \| `Paid` \| `Overdue` |
| `dueDate` | S | Payment due date (ISO 8601 date) |
| `xmlS3Key` | S | S3 key for FatturaPA XML file |
| `paymentTerms` | S | e.g., `30 giorni data fattura` |
| `createdAt` | S | ISO 8601 timestamp |
| `updatedAt` | S | ISO 8601 timestamp |
| `paidAt` | S | Timestamp when marked as paid |

### 6.11 Invoice Item

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `JOB#<userId>#<jobId>` |
| `SK` | S | `INVOICE#ITEM#<seq>` (zero-padded) |
| `entityType` | S | `InvoiceItem` |
| `seq` | N | Sequence number |
| `description` | S | Line item description |
| `quantity` | N | Quantity |
| `unit` | S | Unit of measure |
| `unitPrice` | N | Price per unit |
| `lineTotal` | N | `quantity × unitPrice` |

### 6.12 Monthly Analytics

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `USER#<userId>` |
| `SK` | S | `ANALYTICS#<YYYY-MM>` |
| `entityType` | S | `MonthlyAnalytics` |
| `month` | S | `YYYY-MM` |
| `totalRevenue` | N | Sum of paid invoices in the period |
| `jobsCreated` | N | Count of jobs created |
| `jobsCompleted` | N | Count of jobs reaching "Completed" status |
| `completionRate` | N | `jobsCompleted / jobsCreated` (decimal) |
| `avgQuoteToInvoiceDays` | N | Average days from quote creation to invoice |
| `totalMaterialCost` | N | Sum of all material costs |
| `invoicesPaid` | N | Count of invoices marked as paid |
| `invoicesOverdue` | N | Count of overdue invoices at month end |
| `aggregatedAt` | S | ISO 8601 timestamp of last aggregation run |

### 6.13 Notification Log

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | S | `USER#<userId>` |
| `SK` | S | `NOTIFY#<timestamp>` |
| `entityType` | S | `NotificationLog` |
| `type` | S | `InvoiceReminder` \| `OverdueAlert` \| `SmsReminder` |
| `channel` | S | `email` \| `sms` |
| `recipientEmail` | S | Recipient email (for email notifications) |
| `recipientPhone` | S | Recipient phone (for SMS) |
| `invoiceNumber` | S | Related invoice (if applicable) |
| `jobId` | S | Related job |
| `status` | S | `Sent` \| `Failed` |
| `ttl` | N | Unix epoch for auto-deletion (90 days after creation) |
| `createdAt` | S | ISO 8601 timestamp |

---

## 7. Sample Items

### 7.1 User Profile

```json
{
  "PK": "USER#a1b2c3d4",
  "SK": "PROFILE",
  "entityType": "UserProfile",
  "email": "marco.rossi@email.it",
  "fullName": "Marco Rossi",
  "businessName": "Rossi Impianti Idraulici",
  "partitaIva": "IT12345678901",
  "codiceFiscale": "RSSMRC85M01H501Z",
  "regimeFiscale": "RF19",
  "address": {
    "street": "Via Roma 42",
    "city": "Carmagnola",
    "province": "TO",
    "cap": "10022",
    "country": "IT"
  },
  "phone": "+393331234567",
  "createdAt": "2026-04-15T10:00:00Z",
  "updatedAt": "2026-04-15T10:00:00Z"
}
```

### 7.2 Job Header

```json
{
  "PK": "USER#a1b2c3d4",
  "SK": "JOB#00003",
  "GSI1PK": "USER#a1b2c3d4",
  "GSI1SK": "JOB#InProgress#2026-04-20T14:30:00Z",
  "GSI2PK": "USER_JOBS#a1b2c3d4",
  "GSI2SK": "2026-04-20T14:30:00Z",
  "entityType": "Job",
  "jobId": 3,
  "clientId": "01HXYZ1234ABCDEF",
  "clientName": "Luigi Bianchi",
  "description": "Rifacimento impianto idraulico bagno principale, sostituzione tubazioni in rame con multistrato",
  "address": "Via Garibaldi 15, Carmagnola (TO)",
  "targetDate": "2026-05-10",
  "status": "InProgress",
  "createdAt": "2026-04-20T14:30:00Z",
  "updatedAt": "2026-04-22T09:15:00Z"
}
```

### 7.3 Quote with Line Items

```json
{
  "PK": "JOB#a1b2c3d4#00003",
  "SK": "QUOTE",
  "entityType": "Quote",
  "totalAmount": 2850.00,
  "currency": "EUR",
  "inputText": "Devo rifare l'impianto idraulico del bagno principale. Sostituzione di tutte le tubazioni in rame con multistrato, installazione di un nuovo miscelatore termostatico per la doccia, sostituzione del WC con uno sospeso e installazione di un nuovo lavabo con mobile. Serve anche lo smontaggio e rimontaggio delle piastrelle attorno ai punti di intervento.",
  "inputLength": 382,
  "generationTimeMs": 4200,
  "itemCount": 6,
  "pdfS3Key": "users/a1b2c3d4/jobs/00003/quote.pdf",
  "status": "Approved",
  "sentAt": "2026-04-20T16:00:00Z",
  "createdAt": "2026-04-20T15:00:00Z",
  "updatedAt": "2026-04-20T15:45:00Z"
}
```

```json
{
  "PK": "JOB#a1b2c3d4#00003",
  "SK": "QUOTE#ITEM#001",
  "entityType": "QuoteItem",
  "seq": 1,
  "description": "Rimozione impianto idraulico esistente in rame",
  "quantity": 1,
  "unit": "intervento",
  "unitPrice": 350.00,
  "lineTotal": 350.00
}
```

### 7.4 Invoice

```json
{
  "PK": "JOB#a1b2c3d4#00003",
  "SK": "INVOICE",
  "GSI1PK": "USER#a1b2c3d4",
  "GSI1SK": "INV#Sent#2026-05-12T10:00:00Z",
  "GSI2PK": "INV_STATUS#Sent",
  "GSI2SK": "2026-06-11",
  "entityType": "Invoice",
  "invoiceNumber": "2026/003",
  "userId": "a1b2c3d4",
  "jobId": "00003",
  "clientName": "Luigi Bianchi",
  "clientEmail": "luigi.bianchi@email.it",
  "totalAmount": 3477.00,
  "vatAmount": 627.00,
  "vatRate": 22,
  "currency": "EUR",
  "status": "Sent",
  "dueDate": "2026-06-11",
  "xmlS3Key": "users/a1b2c3d4/jobs/00003/fattura_2026_003.xml",
  "paymentTerms": "30 giorni data fattura",
  "createdAt": "2026-05-12T10:00:00Z",
  "updatedAt": "2026-05-12T10:00:00Z",
  "paidAt": null
}
```

### 7.5 Photo

```json
{
  "PK": "JOB#a1b2c3d4#00003",
  "SK": "PHOTO#01HXYZ5678GHIJKL",
  "entityType": "Photo",
  "photoId": "01HXYZ5678GHIJKL",
  "s3Key": "users/a1b2c3d4/jobs/00003/photos/01HXYZ5678GHIJKL.jpg",
  "tag": "Before",
  "mimeType": "image/jpeg",
  "sizeBytes": 3245000,
  "aiDescription": "Tubazioni in rame ossidate visibili sotto il lavabo esistente. Presenza di calcare sui raccordi. Pavimento in ceramica bianca 20x20 con fughe scurite.",
  "aiDescriptionEdited": false,
  "uploadedAt": "2026-04-21T08:30:00Z"
}
```

---

## 8. S3 Key Structure

All user-generated and system-generated files are stored in a single S3 bucket with a hierarchical prefix structure. This enables per-user lifecycle policies and IAM scoping.

```
cantieresnap-data-{environment}/
├── users/
│   └── {userId}/
│       └── jobs/
│           └── {jobId}/
│               ├── quote.pdf
│               ├── fattura_{invoiceNumber}.xml
│               └── photos/
│                   ├── {photoId}.jpg
│                   └── {photoId}.png
│               └── receipts/
│                   └── {materialId}.jpg
```

**Lifecycle policies (NFR-COST-003):**

| Rule | Prefix | Transition | Days |
|------|--------|------------|------|
| IA transition | `users/` | Move to S3 Infrequent Access | 90 |
| Expiration | `users/` | Delete object | 365 (configurable) |

**Presigned URL validity (NFR-SEC-003):** 15 minutes for upload, 60 minutes for download.

---

## 9. Capacity and Cost Model

CantiereSnap uses on-demand (PAY_PER_REQUEST) billing. The following estimates assume the validation phase with 10 active tradespeople, each managing 15 jobs per month.

### 9.1 Item Size Estimates

| Entity | Avg Item Size | Items per Job | Items per User/Month |
|--------|--------------|---------------|---------------------|
| Job | ~500 B | 1 | 15 |
| Quote | ~400 B | 1 | 15 |
| Quote Items | ~200 B | 5 | 75 |
| Photos | ~300 B (metadata) | 4 | 60 |
| Materials | ~200 B | 3 | 45 |
| Invoice | ~500 B | 1 | 15 |
| Invoice Items | ~200 B | 5 | 75 |
| Status History | ~150 B | 4 | 60 |
| Analytics | ~300 B | — | 1 |

### 9.2 Monthly Request Estimates (10 users)

| Operation | Estimated Requests | Cost (on-demand) |
|-----------|-------------------|-----------------|
| Write requests | ~6,000 | $0.0075 |
| Read requests | ~30,000 | $0.0075 |
| Storage (cumulative) | <1 GB | $0.25 |
| GSI writes | ~3,000 | $0.00375 |
| **Total DynamoDB** | | **< $0.30/month** |

All estimates fall within the AWS Free Tier (25 GB storage, 25 WCU, 25 RCU provisioned-equivalent for on-demand). At this scale, DynamoDB costs are effectively zero (NFR-COST-001).

---

## 10. Transaction Patterns

Several operations span multiple items and require atomicity. DynamoDB provides `TransactWriteItems` (up to 100 items, all-or-nothing) and `BatchWriteItems` (up to 25 items, best-effort). The schema uses both.

### 10.1 Job Status Transition (TransactWriteItems)

When a tradesperson moves a job to a new status, two writes must succeed together: the job header update and the status history entry. A partial write — where the job status changes but the history record is lost — would break the audit trail required by FR-JOB-004.

```
TransactWriteItems:
  1. UpdateItem:  PK = USER#<userId>, SK = JOB#<jobId>
                  SET status = :newStatus, updatedAt = :now,
                      GSI1SK = JOB#:newStatus#:createdAt
  2. PutItem:     PK = JOB#<userId>#<jobId>, SK = STATUS#<timestamp>
                  fromStatus = :oldStatus, toStatus = :newStatus,
                  changedAt = :now
```

When the target status is `Invoiced`, a condition expression on item 1 verifies that an invoice exists for the job (preventing a status transition without an actual invoice).

### 10.2 Quote Creation (BatchWriteItems)

After the Claude API returns structured line items and the tradesperson approves them, the quote metadata and all line items are written in a single batch. This is not transactional (some items could fail), but at the expected item count (5–10 line items), failures are retried automatically by the AWS SDK.

```
BatchWriteItems:
  1. PutItem:  PK = JOB#<userId>#<jobId>, SK = QUOTE           (metadata)
  2. PutItem:  PK = JOB#<userId>#<jobId>, SK = QUOTE#ITEM#001  (line item 1)
  3. PutItem:  PK = JOB#<userId>#<jobId>, SK = QUOTE#ITEM#002  (line item 2)
  ...
```

### 10.3 Invoice Creation (TransactWriteItems)

Invoice creation is transactional because it updates the job status to `Invoiced` and writes the invoice metadata simultaneously. This prevents orphaned invoices (invoice without job update) or ghost transitions (job marked as invoiced without an invoice record).

```
TransactWriteItems:
  1. UpdateItem:  PK = USER#<userId>, SK = JOB#<jobId>
                  SET status = "Invoiced", GSI1SK = JOB#Invoiced#:createdAt
  2. PutItem:     PK = JOB#<userId>#<jobId>, SK = INVOICE
                  (all invoice attributes + GSI1/GSI2 projections)
  3. PutItem:     PK = JOB#<userId>#<jobId>, SK = STATUS#<timestamp>
                  fromStatus = "Completed", toStatus = "Invoiced"
  4–N. PutItem:   PK = JOB#<userId>#<jobId>, SK = INVOICE#ITEM#<seq>
                  (one per line item)
```

### 10.4 Invoice Status Update with GSI Reindexing

When an invoice status changes (e.g., `Sent` → `Paid`), both GSI-1 and GSI-2 projections must update. Since DynamoDB reindexes GSIs automatically on attribute change, a single `UpdateItem` on the invoice record handles this — the application updates `status`, `GSI1SK`, and `GSI2PK` in one call.

```
UpdateItem:  PK = JOB#<userId>#<jobId>, SK = INVOICE
             SET status = "Paid",
                 GSI1SK = INV#Paid#:createdAt,
                 GSI2PK = INV_STATUS#Paid,
                 paidAt = :now, updatedAt = :now
```

---

## 11. Known Limitations and Future Considerations

### 11.1 Full-Text Search on Job Descriptions

FR-JOB-006 requires a search bar matching against client name and job description. Client name search is handled by GSI-1 (`begins_with` on the normalised name). Job description search uses a `FilterExpression` with `contains()` on the main table query (AP-40).

`FilterExpression` applies *after* DynamoDB reads the items, so it does not reduce consumed read capacity — every job header in the partition is read and then filtered. At the current scale (fewer than 30 active jobs per tradesperson), this is acceptable: a single Query reads roughly 15 KB of data.

If the user base grows beyond 50 active users or job volumes increase significantly, two alternatives are available: integrating Amazon OpenSearch Service for full-text search, or maintaining a client-side search index using a lightweight library (e.g., Fuse.js) that indexes job data already loaded for the Kanban view. The client-side approach adds zero infrastructure cost and is the recommended first upgrade.

### 11.2 SMS Reminder Query Efficiency

As documented in Section 4.2, SMS appointment reminders (FR-NOTIFY-003, "Could" priority) rely on a `FilterExpression` on `targetDate` rather than a dedicated GSI. This means the daily Lambda reads all jobs for each user to find those with a matching target date. Promoting this feature to "Must" priority warrants a dedicated GSI-3 with `GSI3PK = JOB_TARGET_DATE` and `GSI3SK = <targetDate>` for a single cross-user query.

### 11.3 Hot Partition Risk on GSI-2

The `INV_STATUS#Sent` partition in GSI-2 aggregates all sent invoices across all users. At the current scale (fewer than 50 users, each with 5–10 active invoices), this partition stays well under DynamoDB's 10 GB and 3,000 RCU limits. If CantiereSnap scales to thousands of users, the partition key should be sharded (e.g., `INV_STATUS#Sent#<shard>` with a modulo-based shard key) to distribute reads.

### 11.4 Eventual Consistency on GSI Reads

All GSI queries return eventually consistent data. In practice, GSI propagation completes within milliseconds, but the application should not assume strong consistency. For the Kanban board (AP-10), a job status transition that the tradesperson just performed may take a fraction of a second to reflect in the filtered view. The UI handles this by optimistically updating the local state before confirming with the server response.
