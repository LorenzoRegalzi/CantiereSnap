# CantiereSnap — REST API Specification

| | |
|---|---|
| **Version** | 1.0 |
| **Date** | 28 April 2026 |
| **Author** | Lorenzo Regalzi |
| **Supervisor** | Prof. Lokesh Vij |
| **Program** | OPIT — BSc Modern Computer Science |
| **Status** | Draft |

Capstone Project — 5th Term, Fast-Track

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 28 Apr 2026 | Lorenzo Regalzi | Initial draft |

---

## Table of Contents

- [1. Overview](#1-overview)
  - [1.1 Base URL](#11-base-url)
  - [1.2 Authentication](#12-authentication)
  - [1.3 Request and Response Format](#13-request-and-response-format)
  - [1.4 Error Handling](#14-error-handling)
  - [1.5 Rate Limiting](#15-rate-limiting)
- [2. Auth Endpoints](#2-auth-endpoints)
  - [2.1 POST /auth/register](#21-post-authregister)
  - [2.2 POST /auth/verify](#22-post-authverify)
  - [2.3 POST /auth/login](#23-post-authlogin)
  - [2.4 POST /auth/refresh](#24-post-authrefresh)
- [3. Profile Endpoints](#3-profile-endpoints)
  - [3.1 GET /profile](#31-get-profile)
  - [3.2 PUT /profile](#32-put-profile)
- [4. Client Endpoints](#4-client-endpoints)
  - [4.1 POST /clients](#41-post-clients)
  - [4.2 GET /clients](#42-get-clients)
  - [4.3 GET /clients/{clientId}](#43-get-clientsclientid)
  - [4.4 PUT /clients/{clientId}](#44-put-clientsclientid)
- [5. Job Endpoints](#5-job-endpoints)
  - [5.1 POST /jobs](#51-post-jobs)
  - [5.2 GET /jobs](#52-get-jobs)
  - [5.3 GET /jobs/{jobId}](#53-get-jobsjobid)
  - [5.4 GET /jobs/{jobId}/details](#54-get-jobsjobiddetails)
  - [5.5 PATCH /jobs/{jobId}/status](#55-patch-jobsjobidstatus)
- [6. Quote Endpoints](#6-quote-endpoints)
  - [6.1 POST /jobs/{jobId}/quote/generate](#61-post-jobsjobidquotegenerate)
  - [6.2 GET /jobs/{jobId}/quote](#62-get-jobsjobidquote)
  - [6.3 PUT /jobs/{jobId}/quote/items/{seq}](#63-put-jobsjobidquoteitemsseq)
  - [6.4 POST /jobs/{jobId}/quote/items](#64-post-jobsjobidquoteitems)
  - [6.5 DELETE /jobs/{jobId}/quote/items/{seq}](#65-delete-jobsjobidquoteitemsseq)
  - [6.6 POST /jobs/{jobId}/quote/finalize](#66-post-jobsjobidquotefinalize)
  - [6.7 POST /jobs/{jobId}/quote/send](#67-post-jobsjobidquotesend)
- [7. Photo Endpoints](#7-photo-endpoints)
  - [7.1 POST /jobs/{jobId}/photos/upload-url](#71-post-jobsjobidphotosupload-url)
  - [7.2 GET /jobs/{jobId}/photos](#72-get-jobsjobidphotos)
  - [7.3 PATCH /jobs/{jobId}/photos/{photoId}](#73-patch-jobsjobidphotosphotoid)
- [8. Material Endpoints (OCR)](#8-material-endpoints-ocr)
  - [8.1 POST /jobs/{jobId}/materials/scan](#81-post-jobsjobidmaterialsscan)
  - [8.2 GET /jobs/{jobId}/materials](#82-get-jobsjobidmaterials)
  - [8.3 POST /jobs/{jobId}/materials](#83-post-jobsjobidmaterials)
  - [8.4 PUT /jobs/{jobId}/materials/{materialId}](#84-put-jobsjobidmaterialsmaterialid)
- [9. Invoice Endpoints](#9-invoice-endpoints)
  - [9.1 POST /jobs/{jobId}/invoice](#91-post-jobsjobidinvoice)
  - [9.2 GET /jobs/{jobId}/invoice](#92-get-jobsjobidinvoice)
  - [9.3 PATCH /jobs/{jobId}/invoice/status](#93-patch-jobsjobidinvoicestatus)
  - [9.4 POST /jobs/{jobId}/invoice/send](#94-post-jobsjobidinvoicesend)
  - [9.5 GET /invoices](#95-get-invoices)
- [10. Dashboard Endpoints](#10-dashboard-endpoints)
  - [10.1 GET /dashboard/analytics](#101-get-dashboardanalytics)
  - [10.2 GET /dashboard/overdue](#102-get-dashboardoverdue)
- [11. Notification Endpoints](#11-notification-endpoints)
  - [11.1 POST /jobs/{jobId}/notify/sms](#111-post-jobsjobidnotifysms)
  - [11.2 GET /notifications](#112-get-notifications)
- [12. Endpoint-to-Requirement Traceability](#12-endpoint-to-requirement-traceability)

---

## 1. Overview

### 1.1 Base URL

```
https://api.cantieresnap.it/v1
```

The API is served through AWS API Gateway (REST) with a CloudFront distribution for edge caching of static responses. All endpoints are versioned under `/v1`. The base domain resolves to the API Gateway regional endpoint via a Route 53 alias record.

### 1.2 Authentication

All endpoints except those under `/auth` require a valid JWT access token issued by AWS Cognito. The token is passed in the `Authorization` header.

```
Authorization: Bearer <access_token>
```

API Gateway validates the JWT through a Cognito authoriser before forwarding the request to the Lambda handler. The authoriser extracts the `sub` claim (user ID) and injects it into the Lambda event context — no endpoint ever receives a user ID from the client directly.

**Token lifecycle:**

| Token | Validity | Purpose |
|-------|----------|---------|
| Access token | 1 hour | Authenticates API requests |
| Refresh token | 30 days | Obtains new access tokens without re-login |

### 1.3 Request and Response Format

All request and response bodies use JSON (`Content-Type: application/json`). Dates follow ISO 8601 format (`2026-04-28T14:30:00Z`). Monetary values are expressed as numbers with two decimal places in EUR.

**Pagination.** List endpoints that may return large result sets accept `limit` (default 20, max 100) and `nextToken` query parameters. When more results are available, the response includes a `nextToken` field that can be passed in the subsequent request.

```json
{
  "items": [ ... ],
  "nextToken": "eyJQSyI6IlVTRVIjYTFiMmMz..."
}
```

The `nextToken` is an opaque, base64-encoded DynamoDB `LastEvaluatedKey`. The client does not need to parse or construct it.

### 1.4 Error Handling

All error responses share a consistent structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Job description must be at least 20 characters.",
    "field": "description"
  }
}
```

The `field` property is present only for validation errors tied to a specific input field.

**Standard error codes:**

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | `VALIDATION_ERROR` | Request body fails schema validation or business rule |
| 400 | `INVALID_STATUS_TRANSITION` | Status change violates the sequential pipeline |
| 401 | `UNAUTHORIZED` | Missing or expired JWT token |
| 403 | `FORBIDDEN` | Token valid but user does not own the resource |
| 404 | `NOT_FOUND` | Resource does not exist or belongs to another user |
| 409 | `CONFLICT` | Resource already exists (e.g., duplicate invoice for a job) |
| 429 | `RATE_LIMIT_EXCEEDED` | Throttling limit reached |
| 500 | `INTERNAL_ERROR` | Unhandled server error |
| 502 | `AI_SERVICE_UNAVAILABLE` | Claude API or Textract returned an error or timed out |

### 1.5 Rate Limiting

API Gateway enforces a throttle of 100 requests per second per user (NFR-SEC-005). When exceeded, the API returns `429` with a `Retry-After` header indicating the number of seconds to wait.

---

## 2. Auth Endpoints

Auth endpoints are the only unprotected routes. They proxy to AWS Cognito operations via Lambda handlers.

### 2.1 POST /auth/register

Creates a new tradesperson account and triggers email verification.

**Requirement:** FR-AUTH-001, FR-AUTH-002

**Request Body:**

```json
{
  "email": "marco.rossi@email.it",
  "password": "SecurePass123",
  "fullName": "Marco Rossi"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | yes | Valid email format |
| `password` | string | yes | Minimum 8 characters |
| `fullName` | string | yes | 2–100 characters |

**Response — 201 Created:**

```json
{
  "message": "Registration successful. Check your email for verification.",
  "userId": "a1b2c3d4"
}
```

**Errors:** `400 VALIDATION_ERROR` (invalid email or weak password), `409 CONFLICT` (email already registered).

**Side effect:** Cognito sends a verification email via SES with a confirmation link.

### 2.2 POST /auth/verify

Confirms the tradesperson's email address using the verification code sent by Cognito.

**Requirement:** FR-AUTH-002

**Request Body:**

```json
{
  "email": "marco.rossi@email.it",
  "confirmationCode": "482910"
}
```

**Response — 200 OK:**

```json
{
  "message": "Email verified. You can now log in."
}
```

**Errors:** `400 VALIDATION_ERROR` (invalid or expired code), `404 NOT_FOUND` (email not registered).

### 2.3 POST /auth/login

Authenticates the tradesperson and returns JWT tokens.

**Requirement:** FR-AUTH-003

**Request Body:**

```json
{
  "email": "marco.rossi@email.it",
  "password": "SecurePass123"
}
```

**Response — 200 OK:**

```json
{
  "accessToken": "eyJraWQiOiJ...",
  "refreshToken": "eyJjdHkiOiJ...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

| Field | Description |
|-------|-------------|
| `accessToken` | JWT for API requests, valid 1 hour |
| `refreshToken` | Token for obtaining new access tokens, valid 30 days |
| `expiresIn` | Access token validity in seconds |

**Errors:** `401 UNAUTHORIZED` (wrong credentials), `400 VALIDATION_ERROR` (email not verified).

### 2.4 POST /auth/refresh

Exchanges a valid refresh token for a new access token without requiring the tradesperson to re-enter credentials.

**Requirement:** FR-AUTH-005

**Request Body:**

```json
{
  "refreshToken": "eyJjdHkiOiJ..."
}
```

**Response — 200 OK:**

```json
{
  "accessToken": "eyJraWQiOiJ...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Errors:** `401 UNAUTHORIZED` (refresh token expired — tradesperson must re-login).

---

## 3. Profile Endpoints

The tradesperson's profile stores fiscal data required for *FatturaPA* generation. Profile data maps to the `UserProfile` entity in DynamoDB (`PK = USER#<userId>`, `SK = PROFILE`).

### 3.1 GET /profile

Returns the authenticated tradesperson's profile.

**Requirement:** FR-INV-001 (fiscal data needed for invoice generation)

**DynamoDB access pattern:** AP-01

**Response — 200 OK:**

```json
{
  "userId": "a1b2c3d4",
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

### 3.2 PUT /profile

Updates the tradesperson's profile. Partial updates are supported — only the fields included in the request body are modified.

**Requirement:** FR-INV-001

**DynamoDB access pattern:** AP-02

**Request Body (example — partial update):**

```json
{
  "businessName": "Rossi Impianti Idraulici di Marco Rossi",
  "address": {
    "street": "Via Roma 42/A",
    "city": "Carmagnola",
    "province": "TO",
    "cap": "10022",
    "country": "IT"
  }
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `fullName` | string | no | 2–100 characters |
| `businessName` | string | no | 2–200 characters |
| `partitaIva` | string | no | Italian VAT format: `IT` + 11 digits |
| `codiceFiscale` | string | no | 16 alphanumeric characters |
| `regimeFiscale` | string | no | Valid regime code (e.g., `RF01`, `RF19`) |
| `address` | object | no | All sub-fields required if object is provided |
| `phone` | string | no | International format with `+` prefix |

**Response — 200 OK:** Returns the full updated profile (same schema as GET /profile).

**Errors:** `400 VALIDATION_ERROR` (invalid Partita IVA format, missing address sub-fields).

---

## 4. Client Endpoints

Clients are scoped to the authenticated tradesperson. Each client record holds the contact and fiscal data reused across jobs, quotes, and invoices.

### 4.1 POST /clients

Creates a new client in the tradesperson's registry.

**Requirement:** FR-JOB-001

**DynamoDB access pattern:** AP-05

**Request Body:**

```json
{
  "clientName": "Luigi Bianchi",
  "email": "luigi.bianchi@email.it",
  "phone": "+393339876543",
  "codiceFiscale": "BNCLGU80A01H501Y",
  "partitaIva": null,
  "address": {
    "street": "Via Garibaldi 15",
    "city": "Carmagnola",
    "province": "TO",
    "cap": "10022",
    "country": "IT"
  }
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `clientName` | string | yes | 2–200 characters |
| `email` | string | yes | Valid email format |
| `phone` | string | no | International format |
| `codiceFiscale` | string | yes | 16 alphanumeric characters (required for *FatturaPA*) |
| `partitaIva` | string | no | `IT` + 11 digits, if the client is a business |
| `address` | object | yes | All sub-fields required |

**Response — 201 Created:**

```json
{
  "clientId": "01HXYZ1234ABCDEF",
  "clientName": "Luigi Bianchi",
  "email": "luigi.bianchi@email.it",
  "phone": "+393339876543",
  "codiceFiscale": "BNCLGU80A01H501Y",
  "partitaIva": null,
  "address": {
    "street": "Via Garibaldi 15",
    "city": "Carmagnola",
    "province": "TO",
    "cap": "10022",
    "country": "IT"
  },
  "createdAt": "2026-04-28T10:00:00Z"
}
```

### 4.2 GET /clients

Lists all clients for the authenticated tradesperson.

**DynamoDB access pattern:** AP-03 (table query), AP-04 (GSI-1 name search)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | — | Prefix search on client name (uses GSI-1) |
| `limit` | integer | 20 | Results per page (max 100) |
| `nextToken` | string | — | Pagination token |

**Response — 200 OK:**

```json
{
  "items": [
    {
      "clientId": "01HXYZ1234ABCDEF",
      "clientName": "Luigi Bianchi",
      "email": "luigi.bianchi@email.it",
      "phone": "+393339876543",
      "codiceFiscale": "BNCLGU80A01H501Y"
    }
  ],
  "nextToken": null
}
```

### 4.3 GET /clients/{clientId}

Returns a single client by ID.

**Path Parameters:** `clientId` (string, ULID)

**Response — 200 OK:** Full client object (same schema as POST response).

**Errors:** `404 NOT_FOUND`.

### 4.4 PUT /clients/{clientId}

Updates client data. Accepts partial updates.

**Path Parameters:** `clientId` (string, ULID)

**DynamoDB access pattern:** AP-05

**Request Body:** Same fields as POST, all optional. Only provided fields are updated.

**Response — 200 OK:** Full updated client object.

**Errors:** `404 NOT_FOUND`, `400 VALIDATION_ERROR`.

---

## 5. Job Endpoints

Jobs are the core entity. Each job progresses through five sequential stages: Quote → Accepted → In Progress → Completed → Invoiced. The API enforces this order — skipping stages returns a `400 INVALID_STATUS_TRANSITION` error.

### 5.1 POST /jobs

Creates a new job and assigns it a sequential ID.

**Requirement:** FR-JOB-001, FR-JOB-002

**DynamoDB access pattern:** AP-06 (atomic counter), AP-07 (put job)

**Request Body:**

```json
{
  "clientId": "01HXYZ1234ABCDEF",
  "description": "Rifacimento impianto idraulico bagno principale, sostituzione tubazioni in rame con multistrato.",
  "address": "Via Garibaldi 15, Carmagnola (TO)",
  "targetDate": "2026-05-10"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `clientId` | string | yes | Must reference an existing client |
| `description` | string | yes | 10–5000 characters |
| `address` | string | yes | 5–500 characters |
| `targetDate` | string | yes | ISO 8601 date, must be today or later |

**Response — 201 Created:**

```json
{
  "jobId": 3,
  "jobIdFormatted": "00003",
  "clientId": "01HXYZ1234ABCDEF",
  "clientName": "Luigi Bianchi",
  "description": "Rifacimento impianto idraulico bagno principale, sostituzione tubazioni in rame con multistrato.",
  "address": "Via Garibaldi 15, Carmagnola (TO)",
  "targetDate": "2026-05-10",
  "status": "Quote",
  "createdAt": "2026-04-28T10:30:00Z",
  "updatedAt": "2026-04-28T10:30:00Z"
}
```

The `clientName` is denormalised from the client record at creation time for display in the Kanban board.

### 5.2 GET /jobs

Lists jobs for the authenticated tradesperson, with optional status filtering and text search.

**Requirement:** FR-JOB-005, FR-JOB-006

**DynamoDB access pattern:** AP-09 (all jobs), AP-10 (by status), AP-15 (by date range), AP-40 (text search)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | — | Filter by status. Accepts comma-separated values: `Quote,Accepted,InProgress` |
| `search` | string | — | Text search matching `clientName` and `description` |
| `startDate` | string | — | Filter jobs created on or after this date (ISO 8601) |
| `endDate` | string | — | Filter jobs created on or before this date (ISO 8601) |
| `limit` | integer | 50 | Results per page (max 100) |
| `nextToken` | string | — | Pagination token |

**Query routing logic:** When `status` is provided, the Lambda queries GSI-1 (`begins_with JOB#<status>#`). When `startDate`/`endDate` are provided without `status`, the Lambda queries GSI-2 (`BETWEEN`). When `search` is provided, the Lambda queries the main table with a `FilterExpression` containing `contains(description, :term)`. Combined filters apply the narrowest index query first, then `FilterExpression` for remaining conditions.

**Response — 200 OK:**

```json
{
  "items": [
    {
      "jobId": 3,
      "jobIdFormatted": "00003",
      "clientId": "01HXYZ1234ABCDEF",
      "clientName": "Luigi Bianchi",
      "description": "Rifacimento impianto idraulico bagno principale...",
      "address": "Via Garibaldi 15, Carmagnola (TO)",
      "targetDate": "2026-05-10",
      "status": "InProgress",
      "createdAt": "2026-04-20T14:30:00Z",
      "updatedAt": "2026-04-22T09:15:00Z"
    }
  ],
  "nextToken": null
}
```

### 5.3 GET /jobs/{jobId}

Returns a single job header.

**Requirement:** FR-JOB-001

**DynamoDB access pattern:** AP-08

**Path Parameters:** `jobId` (integer)

**Response — 200 OK:** Full job object (same schema as items in GET /jobs).

**Errors:** `404 NOT_FOUND`.

### 5.4 GET /jobs/{jobId}/details

Returns the job header with all child entities: status history, quote with line items, photos, materials, and invoice with line items. This powers the job detail page with a single API call.

**Requirement:** FR-JOB-001, FR-JOB-004

**DynamoDB access pattern:** AP-14 (query full job partition)

**Path Parameters:** `jobId` (integer)

**Response — 200 OK:**

```json
{
  "job": {
    "jobId": 3,
    "jobIdFormatted": "00003",
    "clientId": "01HXYZ1234ABCDEF",
    "clientName": "Luigi Bianchi",
    "description": "Rifacimento impianto idraulico bagno principale...",
    "address": "Via Garibaldi 15, Carmagnola (TO)",
    "targetDate": "2026-05-10",
    "status": "InProgress",
    "createdAt": "2026-04-20T14:30:00Z",
    "updatedAt": "2026-04-22T09:15:00Z"
  },
  "statusHistory": [
    {
      "fromStatus": null,
      "toStatus": "Quote",
      "changedAt": "2026-04-20T14:30:00Z"
    },
    {
      "fromStatus": "Quote",
      "toStatus": "Accepted",
      "changedAt": "2026-04-21T08:00:00Z"
    },
    {
      "fromStatus": "Accepted",
      "toStatus": "InProgress",
      "changedAt": "2026-04-22T09:15:00Z"
    }
  ],
  "quote": {
    "totalAmount": 2850.00,
    "currency": "EUR",
    "status": "Approved",
    "pdfUrl": "https://cdn.cantieresnap.it/users/a1b2c3d4/jobs/00003/quote.pdf?...",
    "createdAt": "2026-04-20T15:00:00Z",
    "items": [
      {
        "seq": 1,
        "description": "Rimozione impianto idraulico esistente in rame",
        "quantity": 1,
        "unit": "intervento",
        "unitPrice": 350.00,
        "lineTotal": 350.00
      }
    ]
  },
  "photos": [
    {
      "photoId": "01HXYZ5678GHIJKL",
      "tag": "Before",
      "imageUrl": "https://cdn.cantieresnap.it/users/a1b2c3d4/jobs/00003/photos/01HXYZ5678GHIJKL.jpg?...",
      "aiDescription": "Tubazioni in rame ossidate visibili sotto il lavabo esistente...",
      "aiDescriptionEdited": false,
      "uploadedAt": "2026-04-21T08:30:00Z"
    }
  ],
  "materials": [
    {
      "materialId": "01HXYZ9012MNOPQR",
      "itemName": "Tubo multistrato 20mm",
      "quantity": 12,
      "cost": 48.00,
      "confidence": 95,
      "verified": true,
      "createdAt": "2026-04-23T11:00:00Z"
    }
  ],
  "invoice": null
}
```

The `imageUrl` and `pdfUrl` fields are presigned S3 URLs generated at response time with a 60-minute validity (NFR-SEC-003). If a child entity does not exist (e.g., no invoice yet), its field is `null`. If a collection is empty (e.g., no photos), it returns an empty array.

### 5.5 PATCH /jobs/{jobId}/status

Advances a job to the next stage in the pipeline. The API validates that the transition is sequential.

**Requirement:** FR-JOB-003, FR-JOB-004

**DynamoDB access pattern:** AP-11 (update job), AP-12 (record transition) — executed as a `TransactWriteItems` (see DynamoDB Schema Design, Section 10.1)

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "status": "InProgress"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `status` | string | yes | Must be the next valid status in the pipeline |

**Valid transitions:**

| Current Status | Allowed Next Status |
|----------------|-------------------|
| Quote | Accepted |
| Accepted | InProgress |
| InProgress | Completed |
| Completed | Invoiced (only if an invoice exists for this job) |

**Response — 200 OK:**

```json
{
  "jobId": 3,
  "previousStatus": "Accepted",
  "newStatus": "InProgress",
  "transitionTimestamp": "2026-04-22T09:15:00Z"
}
```

**Errors:** `400 INVALID_STATUS_TRANSITION` (e.g., attempting to move from Quote to InProgress), `409 CONFLICT` (attempting to mark as Invoiced without an invoice record).

---

## 6. Quote Endpoints

The quote lifecycle follows three stages: AI generation → tradesperson review and editing → finalisation and PDF generation. The Claude API is called only during the `generate` step. Editing operates on the structured data without additional AI calls.

### 6.1 POST /jobs/{jobId}/quote/generate

Sends the job description to the Claude API and returns structured line items for review.

**Requirement:** FR-QUOTE-001, FR-QUOTE-002, FR-QUOTE-006

**DynamoDB access pattern:** AP-16, AP-17 (batch write quote + items)

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "description": "Devo rifare l'impianto idraulico del bagno principale. Sostituzione di tutte le tubazioni in rame con multistrato, installazione di un nuovo miscelatore termostatico per la doccia, sostituzione del WC con uno sospeso e installazione di un nuovo lavabo con mobile. Serve anche lo smontaggio e rimontaggio delle piastrelle attorno ai punti di intervento.",
  "notes": "Il cliente vuole un miscelatore Grohe."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `description` | string | yes | Minimum 20 characters (FR-QUOTE-001) |
| `notes` | string | no | Additional context for the AI prompt (max 2000 characters) |

If the `description` field is omitted or shorter than 20 characters, the Lambda falls back to the job's `description` field stored in DynamoDB. The optional `notes` field is appended to the AI prompt for context (e.g., brand preferences, material constraints).

**Processing flow:**

1. Lambda retrieves the job record and client data from DynamoDB.
2. Lambda builds the AI prompt: system instructions (structured JSON output, Italian trade context, pricing guidelines) + job description + notes.
3. Lambda calls the Claude API with token limits (input: 2,000 tokens, output: 1,500 tokens) per NFR-COST-002.
4. Lambda parses the Claude response into the `QuoteItem` JSON schema.
5. Lambda writes the quote metadata and items to DynamoDB via `BatchWriteItems`.
6. Lambda logs generation metadata: input length, generation time, item count (FR-QUOTE-006).

**Response — 201 Created:**

```json
{
  "quote": {
    "totalAmount": 2850.00,
    "currency": "EUR",
    "status": "Draft",
    "generationTimeMs": 4200,
    "inputLength": 382,
    "itemCount": 6,
    "createdAt": "2026-04-28T15:00:00Z"
  },
  "items": [
    {
      "seq": 1,
      "description": "Rimozione impianto idraulico esistente in rame",
      "quantity": 1,
      "unit": "intervento",
      "unitPrice": 350.00,
      "lineTotal": 350.00
    },
    {
      "seq": 2,
      "description": "Fornitura e posa tubazioni in multistrato 20mm",
      "quantity": 15,
      "unit": "ml",
      "unitPrice": 28.00,
      "lineTotal": 420.00
    },
    {
      "seq": 3,
      "description": "Installazione miscelatore termostatico Grohe per doccia",
      "quantity": 1,
      "unit": "pz",
      "unitPrice": 320.00,
      "lineTotal": 320.00
    },
    {
      "seq": 4,
      "description": "Fornitura e installazione WC sospeso con cassetta incasso",
      "quantity": 1,
      "unit": "pz",
      "unitPrice": 650.00,
      "lineTotal": 650.00
    },
    {
      "seq": 5,
      "description": "Fornitura e installazione lavabo con mobile",
      "quantity": 1,
      "unit": "pz",
      "unitPrice": 480.00,
      "lineTotal": 480.00
    },
    {
      "seq": 6,
      "description": "Smontaggio e rimontaggio piastrelle nei punti di intervento",
      "quantity": 4,
      "unit": "mq",
      "unitPrice": 157.50,
      "lineTotal": 630.00
    }
  ]
}
```

**Errors:** `502 AI_SERVICE_UNAVAILABLE` (Claude API timeout or error — the tradesperson can still create a manual quote using the item editing endpoints), `409 CONFLICT` (a quote already exists for this job — use the editing endpoints instead).

### 6.2 GET /jobs/{jobId}/quote

Returns the existing quote and its line items for a given job.

**Requirement:** FR-QUOTE-004

**DynamoDB access pattern:** AP-18

**Path Parameters:** `jobId` (integer)

**Response — 200 OK:** Same schema as the `quote` + `items` fields in the generate response.

**Errors:** `404 NOT_FOUND` (no quote generated for this job yet).

### 6.3 PUT /jobs/{jobId}/quote/items/{seq}

Updates a single quote line item. The tradesperson can modify the description, quantity, unit, or unit price. The `lineTotal` is recalculated server-side.

**Requirement:** FR-QUOTE-004

**DynamoDB access pattern:** AP-19

**Path Parameters:** `jobId` (integer), `seq` (integer)

**Request Body:**

```json
{
  "description": "Rimozione impianto idraulico esistente in rame e smaltimento",
  "quantity": 1,
  "unit": "intervento",
  "unitPrice": 400.00
}
```

All fields are optional — only provided fields are updated.

**Response — 200 OK:**

```json
{
  "seq": 1,
  "description": "Rimozione impianto idraulico esistente in rame e smaltimento",
  "quantity": 1,
  "unit": "intervento",
  "unitPrice": 400.00,
  "lineTotal": 400.00
}
```

The quote's `totalAmount` is recalculated and updated atomically.

**Errors:** `404 NOT_FOUND` (item with this seq does not exist).

### 6.4 POST /jobs/{jobId}/quote/items

Adds a new line item to an existing quote. The `seq` is assigned automatically as the next sequential number.

**Requirement:** FR-QUOTE-004

**DynamoDB access pattern:** AP-17

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "description": "Sopralluogo e rilievo misure",
  "quantity": 1,
  "unit": "intervento",
  "unitPrice": 80.00
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `description` | string | yes | 5–500 characters |
| `quantity` | number | yes | Greater than 0 |
| `unit` | string | yes | 1–20 characters |
| `unitPrice` | number | yes | Greater than or equal to 0 |

**Response — 201 Created:** The new item with its assigned `seq` and calculated `lineTotal`.

### 6.5 DELETE /jobs/{jobId}/quote/items/{seq}

Removes a line item from the quote.

**Requirement:** FR-QUOTE-004

**DynamoDB access pattern:** AP-20

**Path Parameters:** `jobId` (integer), `seq` (integer)

**Response — 204 No Content.**

The quote's `totalAmount` is recalculated after deletion.

**Errors:** `404 NOT_FOUND`.

### 6.6 POST /jobs/{jobId}/quote/finalize

Marks the quote as approved and generates a branded PDF stored in S3.

**Requirement:** FR-QUOTE-003

**Path Parameters:** `jobId` (integer)

**Processing flow:**

1. Lambda retrieves the quote metadata and all line items.
2. Lambda generates a PDF with CantiereSnap branding (header, logo, line item table, totals, tradesperson and client contact data).
3. PDF is stored in S3: `users/{userId}/jobs/{jobId}/quote.pdf`.
4. Quote status is updated to `Approved` and the `pdfS3Key` is recorded.

**Response — 200 OK:**

```json
{
  "status": "Approved",
  "pdfUrl": "https://cdn.cantieresnap.it/users/a1b2c3d4/jobs/00003/quote.pdf?X-Amz-...",
  "totalAmount": 2850.00,
  "itemCount": 6,
  "approvedAt": "2026-04-28T16:00:00Z"
}
```

The `pdfUrl` is a presigned URL valid for 60 minutes.

### 6.7 POST /jobs/{jobId}/quote/send

Sends the finalised PDF quote to the client via email.

**Requirement:** FR-QUOTE-005

**Path Parameters:** `jobId` (integer)

**Request Body (optional):**

```json
{
  "recipientEmail": "luigi.bianchi@email.it",
  "message": "Gentile Sig. Bianchi, in allegato il preventivo per i lavori al bagno."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `recipientEmail` | string | no | Valid email. Defaults to client email from job record |
| `message` | string | no | Custom email body text (max 2000 characters) |

**Response — 200 OK:**

```json
{
  "sent": true,
  "recipientEmail": "luigi.bianchi@email.it",
  "sentAt": "2026-04-28T16:05:00Z"
}
```

**Side effect:** SES sends an email with the PDF attached using an HTML template. The quote's `status` is updated to `Sent` and `sentAt` is recorded.

**Errors:** `400 VALIDATION_ERROR` (quote not yet finalised — call `/finalize` first).

---

## 7. Photo Endpoints

Photo uploads use presigned S3 URLs to avoid routing binary data through API Gateway and Lambda. The client uploads directly to S3, which triggers a Lambda via an S3 event notification to generate the AI description.

### 7.1 POST /jobs/{jobId}/photos/upload-url

Generates a presigned S3 URL for direct photo upload from the client device.

**Requirement:** FR-PHOTO-001, FR-PHOTO-003, NFR-SEC-003

**DynamoDB access pattern:** AP-21 (saves photo metadata after URL generation)

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "fileName": "bagno_prima.jpg",
  "mimeType": "image/jpeg",
  "tag": "Before"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `fileName` | string | yes | Must end with `.jpg`, `.jpeg`, or `.png` |
| `mimeType` | string | yes | `image/jpeg` or `image/png` |
| `tag` | string | yes | `Before` or `After` |

**Response — 200 OK:**

```json
{
  "photoId": "01HXYZ5678GHIJKL",
  "uploadUrl": "https://cantieresnap-data-prod.s3.eu-south-1.amazonaws.com/users/a1b2c3d4/jobs/00003/photos/01HXYZ5678GHIJKL.jpg?X-Amz-...",
  "expiresIn": 900,
  "method": "PUT",
  "headers": {
    "Content-Type": "image/jpeg",
    "x-amz-meta-tag": "Before"
  }
}
```

The client performs a `PUT` request to `uploadUrl` with the image binary and the specified headers. The presigned URL expires in 15 minutes (900 seconds) per NFR-SEC-003.

**Client-side upload example:**

```javascript
await fetch(uploadUrl, {
  method: "PUT",
  headers: response.headers,
  body: imageFile  // File or Blob
});
```

**Post-upload processing:** S3 `ObjectCreated` event triggers a Lambda that sends the image to the Claude API for technical description generation (FR-PHOTO-004). The description is written to the photo's DynamoDB record. This happens asynchronously — the client does not wait for the AI description during upload.

### 7.2 GET /jobs/{jobId}/photos

Lists all photos for a job, sorted by upload time.

**Requirement:** FR-PHOTO-001

**DynamoDB access pattern:** AP-22

**Path Parameters:** `jobId` (integer)

**Response — 200 OK:**

```json
{
  "items": [
    {
      "photoId": "01HXYZ5678GHIJKL",
      "tag": "Before",
      "mimeType": "image/jpeg",
      "sizeBytes": 3245000,
      "imageUrl": "https://cdn.cantieresnap.it/users/a1b2c3d4/jobs/00003/photos/01HXYZ5678GHIJKL.jpg?...",
      "aiDescription": "Tubazioni in rame ossidate visibili sotto il lavabo esistente...",
      "aiDescriptionEdited": false,
      "uploadedAt": "2026-04-21T08:30:00Z"
    }
  ]
}
```

If the AI description has not yet been generated (Lambda still processing), `aiDescription` is `null`.

### 7.3 PATCH /jobs/{jobId}/photos/{photoId}

Updates the photo's tag or AI-generated description.

**Requirement:** FR-PHOTO-003, FR-PHOTO-005

**DynamoDB access pattern:** AP-23

**Path Parameters:** `jobId` (integer), `photoId` (string, ULID)

**Request Body:**

```json
{
  "tag": "After",
  "aiDescription": "Nuove tubazioni in multistrato installate e collaudate. Lavabo con mobile montato."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `tag` | string | no | `Before` or `After` |
| `aiDescription` | string | no | 10–2000 characters |

When `aiDescription` is modified, the `aiDescriptionEdited` flag is automatically set to `true`.

**Response — 200 OK:** Updated photo object.

**Errors:** `404 NOT_FOUND`.

---

## 8. Material Endpoints (OCR)

Material costs can be logged via OCR (photographing a receipt) or manual entry. OCR processing uses AWS Textract to extract text, then the Lambda parses the extracted content into structured material entries.

### 8.1 POST /jobs/{jobId}/materials/scan

Uploads a receipt or handwritten note image and processes it through Textract.

**Requirement:** FR-OCR-001, FR-OCR-002, FR-OCR-004

**Path Parameters:** `jobId` (integer)

**Request Body:** `multipart/form-data` with a single `image` field.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `image` | file | yes | JPEG or PNG, max 10 MB |

**Processing flow:**

1. Lambda uploads the image to S3: `users/{userId}/jobs/{jobId}/receipts/{materialId}.jpg`.
2. Lambda sends the image to AWS Textract `AnalyzeDocument` (FORMS + TABLES feature types).
3. Lambda parses the Textract response into structured entries: item name, quantity, cost.
4. If any field has a confidence score below 80%, the entry is flagged with a warning (FR-OCR-004).
5. Entries are saved to DynamoDB with `verified: false`.

**Response — 200 OK:**

```json
{
  "items": [
    {
      "materialId": "01HXYZ9012MNOPQR",
      "itemName": "Tubo multistrato 20mm x 50m",
      "quantity": 2,
      "cost": 48.00,
      "confidence": 95,
      "verified": false
    },
    {
      "materialId": "01HXYZ9013STUVWX",
      "itemName": "Raccordo a pressare 20mm",
      "quantity": 15,
      "cost": 52.50,
      "confidence": 72,
      "warning": "Low confidence on quantity field. Please verify.",
      "verified": false
    }
  ],
  "sourceImageUrl": "https://cdn.cantieresnap.it/users/a1b2c3d4/jobs/00003/receipts/scan_20260428.jpg?..."
}
```

Entries with `confidence < 80` include a `warning` field prompting the tradesperson to review.

**Errors:** `502 AI_SERVICE_UNAVAILABLE` (Textract service error).

### 8.2 GET /jobs/{jobId}/materials

Lists all material entries for a job.

**Requirement:** FR-OCR-003

**DynamoDB access pattern:** AP-25

**Path Parameters:** `jobId` (integer)

**Response — 200 OK:**

```json
{
  "items": [
    {
      "materialId": "01HXYZ9012MNOPQR",
      "itemName": "Tubo multistrato 20mm x 50m",
      "quantity": 2,
      "cost": 48.00,
      "confidence": 95,
      "verified": true,
      "createdAt": "2026-04-23T11:00:00Z"
    }
  ],
  "totalCost": 100.50
}
```

The `totalCost` is calculated server-side as the sum of all material costs for the job.

### 8.3 POST /jobs/{jobId}/materials

Adds a material entry manually (without OCR).

**DynamoDB access pattern:** AP-24

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "itemName": "Silicone sanitario trasparente",
  "quantity": 3,
  "cost": 18.00
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `itemName` | string | yes | 2–200 characters |
| `quantity` | number | yes | Greater than 0 |
| `cost` | number | yes | Greater than or equal to 0 |

**Response — 201 Created:** Material object with `confidence: 100` and `verified: true` (manual entry is inherently verified).

### 8.4 PUT /jobs/{jobId}/materials/{materialId}

Updates a material entry. Typically used after reviewing OCR-extracted data.

**Requirement:** FR-OCR-003

**DynamoDB access pattern:** AP-26

**Path Parameters:** `jobId` (integer), `materialId` (string, ULID)

**Request Body:** Same fields as POST, all optional. Setting any field also sets `verified: true`.

**Response — 200 OK:** Updated material object.

**Errors:** `404 NOT_FOUND`.

---

## 9. Invoice Endpoints

Invoice generation produces a *FatturaPA*-compliant XML file. The system pre-fills data from the job, quote, and client records. The tradesperson can track invoice status through the pipeline: Draft → Sent → Paid / Overdue.

### 9.1 POST /jobs/{jobId}/invoice

Generates a *FatturaPA* XML invoice for a completed job.

**Requirement:** FR-INV-001, FR-INV-002, FR-INV-003

**DynamoDB access pattern:** AP-27, AP-28 (transactional write — see DynamoDB Schema Design, Section 10.3)

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "vatRate": 22,
  "paymentTerms": "30 giorni data fattura",
  "dueDate": "2026-06-11",
  "notes": "Lavori eseguiti presso Via Garibaldi 15, Carmagnola."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `vatRate` | number | yes | 0, 4, 5, 10, or 22 (Italian VAT rates) |
| `paymentTerms` | string | yes | 5–200 characters |
| `dueDate` | string | yes | ISO 8601 date, must be today or later |
| `notes` | string | no | Additional notes for the invoice body (max 2000 characters) |

**Processing flow:**

1. Lambda retrieves the job, quote (with items), client, and tradesperson profile from DynamoDB.
2. Lambda validates that the job status is `Completed` and no invoice already exists.
3. Lambda generates a progressive invoice number (`2026/003`).
4. Lambda calculates VAT: `vatAmount = totalAmount * vatRate / 100`.
5. Lambda builds the *FatturaPA* XML conforming to SDI schema v1.2.
6. XML is stored in S3: `users/{userId}/jobs/{jobId}/fattura_2026_003.xml`.
7. Invoice metadata and line items are written to DynamoDB in a transaction that also records the job status transition to `Invoiced`.

**Response — 201 Created:**

```json
{
  "invoiceNumber": "2026/003",
  "jobId": 3,
  "clientName": "Luigi Bianchi",
  "totalAmount": 3477.00,
  "vatAmount": 627.00,
  "vatRate": 22,
  "currency": "EUR",
  "status": "Draft",
  "dueDate": "2026-06-11",
  "paymentTerms": "30 giorni data fattura",
  "xmlUrl": "https://cdn.cantieresnap.it/users/a1b2c3d4/jobs/00003/fattura_2026_003.xml?...",
  "createdAt": "2026-05-12T10:00:00Z",
  "items": [
    {
      "seq": 1,
      "description": "Rimozione impianto idraulico esistente in rame",
      "quantity": 1,
      "unit": "intervento",
      "unitPrice": 350.00,
      "lineTotal": 350.00
    }
  ]
}
```

**Errors:** `400 INVALID_STATUS_TRANSITION` (job is not in `Completed` status), `409 CONFLICT` (invoice already exists for this job), `400 VALIDATION_ERROR` (tradesperson profile missing fiscal data — Partita IVA, codice fiscale, or regime fiscale not configured).

### 9.2 GET /jobs/{jobId}/invoice

Returns the invoice for a given job, including line items and a fresh presigned URL for the XML file.

**DynamoDB access pattern:** AP-29

**Path Parameters:** `jobId` (integer)

**Response — 200 OK:** Same schema as POST response.

**Errors:** `404 NOT_FOUND` (no invoice for this job).

### 9.3 PATCH /jobs/{jobId}/invoice/status

Updates the invoice status. The tradesperson uses this to mark an invoice as Sent or Paid. The system's EventBridge Lambda uses this internally to mark invoices as Overdue.

**Requirement:** FR-INV-004

**DynamoDB access pattern:** AP-30 (updates main table + GSI-1 and GSI-2 re-index automatically)

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "status": "Paid"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `status` | string | yes | `Sent`, `Paid`, or `Overdue` |

**Valid transitions:**

| Current Status | Allowed Next Status |
|----------------|-------------------|
| Draft | Sent |
| Sent | Paid, Overdue |
| Overdue | Paid |

**Response — 200 OK:**

```json
{
  "invoiceNumber": "2026/003",
  "previousStatus": "Sent",
  "newStatus": "Paid",
  "updatedAt": "2026-06-10T14:00:00Z",
  "paidAt": "2026-06-10T14:00:00Z"
}
```

When status changes to `Paid`, the `paidAt` timestamp is recorded automatically.

**Errors:** `400 INVALID_STATUS_TRANSITION`.

### 9.4 POST /jobs/{jobId}/invoice/send

Sends the *FatturaPA* XML to the client via email.

**Requirement:** FR-INV-005

**Path Parameters:** `jobId` (integer)

**Request Body (optional):**

```json
{
  "recipientEmail": "luigi.bianchi@email.it",
  "message": "Gentile Sig. Bianchi, in allegato la fattura per i lavori completati."
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `recipientEmail` | string | no | Defaults to client email from job record |
| `message` | string | no | Custom email body (max 2000 characters) |

**Response — 200 OK:**

```json
{
  "sent": true,
  "recipientEmail": "luigi.bianchi@email.it",
  "sentAt": "2026-05-12T10:30:00Z"
}
```

**Side effect:** Invoice status is updated to `Sent`. SES sends the email with the XML file attached.

**Errors:** `400 VALIDATION_ERROR` (invoice status is `Draft` — must finalize first or use PATCH to set status to `Sent` manually).

### 9.5 GET /invoices

Lists all invoices for the authenticated tradesperson, with optional status filtering.

**Requirement:** FR-INV-004, FR-DASH-005

**DynamoDB access pattern:** AP-31 (GSI-1 query by status)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | — | Filter by status: `Draft`, `Sent`, `Paid`, `Overdue` |
| `limit` | integer | 20 | Results per page (max 100) |
| `nextToken` | string | — | Pagination token |

**Response — 200 OK:**

```json
{
  "items": [
    {
      "invoiceNumber": "2026/003",
      "jobId": 3,
      "clientName": "Luigi Bianchi",
      "totalAmount": 3477.00,
      "vatAmount": 627.00,
      "status": "Sent",
      "dueDate": "2026-06-11",
      "createdAt": "2026-05-12T10:00:00Z"
    }
  ],
  "nextToken": null
}
```

---

## 10. Dashboard Endpoints

Dashboard data is served from pre-aggregated monthly analytics records (DynamoDB entity `MonthlyAnalytics`), populated by an EventBridge-triggered Lambda on the 1st of each month. For the current month, the Lambda aggregates on-the-fly from live data.

### 10.1 GET /dashboard/analytics

Returns analytics for a date range.

**Requirement:** FR-DASH-001, FR-DASH-002, FR-DASH-003, FR-DASH-004, FR-DASH-006

**DynamoDB access pattern:** AP-34 (single month), AP-35 (range)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startMonth` | string | Current month | Start of range in `YYYY-MM` format |
| `endMonth` | string | Current month | End of range in `YYYY-MM` format |

**Response — 200 OK:**

```json
{
  "period": {
    "start": "2026-01",
    "end": "2026-04"
  },
  "months": [
    {
      "month": "2026-01",
      "totalRevenue": 8500.00,
      "jobsCreated": 12,
      "jobsCompleted": 10,
      "completionRate": 0.83,
      "avgQuoteToInvoiceDays": 18.5,
      "totalMaterialCost": 2100.00,
      "invoicesPaid": 9,
      "invoicesOverdue": 1
    },
    {
      "month": "2026-02",
      "totalRevenue": 6200.00,
      "jobsCreated": 8,
      "jobsCompleted": 7,
      "completionRate": 0.875,
      "avgQuoteToInvoiceDays": 15.2,
      "totalMaterialCost": 1450.00,
      "invoicesPaid": 6,
      "invoicesOverdue": 0
    }
  ],
  "totals": {
    "totalRevenue": 14700.00,
    "jobsCreated": 20,
    "jobsCompleted": 17,
    "completionRate": 0.85,
    "avgQuoteToInvoiceDays": 16.85,
    "totalMaterialCost": 3550.00
  }
}
```

The `totals` object aggregates across all months in the requested range.

### 10.2 GET /dashboard/overdue

Returns all overdue invoices for the authenticated tradesperson. This powers the overdue alert widget on the dashboard.

**Requirement:** FR-DASH-005

**DynamoDB access pattern:** AP-31 (GSI-1, `INV#Overdue#`)

**Response — 200 OK:**

```json
{
  "items": [
    {
      "invoiceNumber": "2026/001",
      "jobId": 1,
      "clientName": "Giovanni Marchetti",
      "totalAmount": 1850.00,
      "dueDate": "2026-03-15",
      "daysOverdue": 44
    }
  ],
  "count": 1,
  "totalOverdueAmount": 1850.00
}
```

`daysOverdue` is calculated server-side as the difference between today and `dueDate`.

---

## 11. Notification Endpoints

Automated notifications (invoice reminders, overdue alerts) are triggered by EventBridge and do not have REST endpoints — they run on schedule via Lambda. The endpoints below cover tradesperson-initiated notifications and notification history.

### 11.1 POST /jobs/{jobId}/notify/sms

Sends an SMS appointment reminder to the client for a specific job.

**Requirement:** FR-NOTIFY-003

**Path Parameters:** `jobId` (integer)

**Request Body:**

```json
{
  "message": "Promemoria: intervento previsto per il 10 maggio 2026 ore 09:00 presso Via Garibaldi 15.",
  "scheduledDate": "2026-05-08"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `message` | string | no | Custom SMS text (max 160 characters). If omitted, a default template is used with job date, time, and address. |
| `scheduledDate` | string | no | ISO 8601 date to schedule the SMS. If omitted, sends immediately. |

**Response — 200 OK:**

```json
{
  "sent": true,
  "recipientPhone": "+393339876543",
  "sentAt": "2026-05-08T08:00:00Z"
}
```

**Side effect:** SNS sends the SMS to the client's phone number from the job record. A notification log entry is written to DynamoDB.

**Errors:** `400 VALIDATION_ERROR` (no phone number stored for the client), `404 NOT_FOUND`.

### 11.2 GET /notifications

Lists recent notification logs for the authenticated tradesperson.

**Requirement:** FR-NOTIFY-001, FR-NOTIFY-002

**DynamoDB access pattern:** AP-38

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Results per page (max 50) |
| `nextToken` | string | — | Pagination token |

**Response — 200 OK:**

```json
{
  "items": [
    {
      "type": "InvoiceReminder",
      "channel": "email",
      "recipientEmail": "luigi.bianchi@email.it",
      "invoiceNumber": "2026/003",
      "jobId": 3,
      "status": "Sent",
      "createdAt": "2026-06-04T08:00:00Z"
    },
    {
      "type": "OverdueAlert",
      "channel": "email",
      "recipientEmail": "marco.rossi@email.it",
      "invoiceNumber": "2026/001",
      "jobId": 1,
      "status": "Sent",
      "createdAt": "2026-03-16T09:00:00Z"
    }
  ],
  "nextToken": null
}
```

Notification logs are sorted by `createdAt` descending (most recent first). Logs older than 90 days are automatically deleted by the DynamoDB TTL.

---

## 12. Endpoint-to-Requirement Traceability

Every REST endpoint maps to one or more functional requirements from the SRS and one or more DynamoDB access patterns from the schema design.

| Endpoint | Method | SRS Requirements | Access Patterns |
|----------|--------|-----------------|-----------------|
| `/auth/register` | POST | FR-AUTH-001, FR-AUTH-002 | — (Cognito) |
| `/auth/verify` | POST | FR-AUTH-002 | — (Cognito) |
| `/auth/login` | POST | FR-AUTH-003 | — (Cognito) |
| `/auth/refresh` | POST | FR-AUTH-005 | — (Cognito) |
| `/profile` | GET | FR-INV-001 | AP-01 |
| `/profile` | PUT | FR-INV-001 | AP-02 |
| `/clients` | POST | FR-JOB-001 | AP-05 |
| `/clients` | GET | FR-JOB-001 | AP-03, AP-04 |
| `/clients/{clientId}` | GET | FR-JOB-001 | AP-05 |
| `/clients/{clientId}` | PUT | FR-JOB-001 | AP-05 |
| `/jobs` | POST | FR-JOB-001, FR-JOB-002 | AP-06, AP-07 |
| `/jobs` | GET | FR-JOB-005, FR-JOB-006 | AP-09, AP-10, AP-15, AP-40 |
| `/jobs/{jobId}` | GET | FR-JOB-001 | AP-08 |
| `/jobs/{jobId}/details` | GET | FR-JOB-001, FR-JOB-004 | AP-14 |
| `/jobs/{jobId}/status` | PATCH | FR-JOB-003, FR-JOB-004 | AP-11, AP-12 |
| `/jobs/{jobId}/quote/generate` | POST | FR-QUOTE-001, FR-QUOTE-002, FR-QUOTE-006 | AP-16, AP-17 |
| `/jobs/{jobId}/quote` | GET | FR-QUOTE-004 | AP-18 |
| `/jobs/{jobId}/quote/items/{seq}` | PUT | FR-QUOTE-004 | AP-19 |
| `/jobs/{jobId}/quote/items` | POST | FR-QUOTE-004 | AP-17 |
| `/jobs/{jobId}/quote/items/{seq}` | DELETE | FR-QUOTE-004 | AP-20 |
| `/jobs/{jobId}/quote/finalize` | POST | FR-QUOTE-003 | AP-16 |
| `/jobs/{jobId}/quote/send` | POST | FR-QUOTE-005 | AP-16 |
| `/jobs/{jobId}/photos/upload-url` | POST | FR-PHOTO-001, FR-PHOTO-003 | AP-21 |
| `/jobs/{jobId}/photos` | GET | FR-PHOTO-001 | AP-22 |
| `/jobs/{jobId}/photos/{photoId}` | PATCH | FR-PHOTO-003, FR-PHOTO-005 | AP-23 |
| `/jobs/{jobId}/materials/scan` | POST | FR-OCR-001, FR-OCR-002, FR-OCR-004 | AP-24 |
| `/jobs/{jobId}/materials` | GET | FR-OCR-003 | AP-25 |
| `/jobs/{jobId}/materials` | POST | FR-OCR-002 | AP-24 |
| `/jobs/{jobId}/materials/{materialId}` | PUT | FR-OCR-003 | AP-26 |
| `/jobs/{jobId}/invoice` | POST | FR-INV-001, FR-INV-002, FR-INV-003 | AP-27, AP-28 |
| `/jobs/{jobId}/invoice` | GET | FR-INV-002 | AP-29 |
| `/jobs/{jobId}/invoice/status` | PATCH | FR-INV-004 | AP-30 |
| `/jobs/{jobId}/invoice/send` | POST | FR-INV-005 | AP-27 |
| `/invoices` | GET | FR-INV-004, FR-DASH-005 | AP-31 |
| `/dashboard/analytics` | GET | FR-DASH-001 to FR-DASH-004, FR-DASH-006 | AP-34, AP-35 |
| `/dashboard/overdue` | GET | FR-DASH-005 | AP-31 |
| `/jobs/{jobId}/notify/sms` | POST | FR-NOTIFY-003 | AP-37 |
| `/notifications` | GET | FR-NOTIFY-001, FR-NOTIFY-002 | AP-38 |

**Automated (EventBridge — no REST endpoint):**

| Trigger | Schedule | Requirements | Access Patterns |
|---------|----------|--------------|-----------------|
| Invoice reminder Lambda | Daily 08:00 UTC | FR-NOTIFY-001 | AP-32, AP-37 |
| Overdue alert Lambda | Daily 09:00 UTC | FR-NOTIFY-002 | AP-33, AP-30, AP-37 |
| Monthly analytics Lambda | 1st of month 02:00 UTC | FR-DASH-001 to FR-DASH-004 | AP-36 |
| SMS target date Lambda | Daily 07:00 UTC | FR-NOTIFY-003 | AP-39, AP-37 |
