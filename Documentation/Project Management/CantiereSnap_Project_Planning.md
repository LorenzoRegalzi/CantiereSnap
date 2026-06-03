# CantiereSnap – Capstone Project Planning

## Project Info

| | |
|---|---|
| **Student** | Lorenzo Regalzi |
| **Email** | lorenzo.r@students.opit.com |
| **Program** | OPIT – BSc Modern Computer Science (5th Term, Fast-Track) |
| **Supervisor** | Prof. Lokesh Vij |
| **Project Title** | CantiereSnap – An AI-Augmented, Serverless Cloud Platform for Micro-Enterprise Job Management in the Italian Construction Sector |
| **Trello Board** | https://trello.com/invite/b/69e9db649c19984589e806cc/ATTIdb18ae2f3aa1f5e15cb20d16db581cad2D234ABE/cantieresnap-capstone-project |

---

## Timeline Overview

| Phase | Period | Status |
|---|---|---|
| Documentation | April 2026 | ✅ Complete (6/6 cards done) |
| Backend Development | May 2026 | ✅ Complete (9/9 cards done, 357 tests) |
| Frontend Development | May–June 2026 | ✅ Complete (7/7 cards done, 22 bugs fixed) |
| Testing & Thesis Writing | June–July 2026 | 🔄 In Progress (3/7 cards done) |
| Review & Submission | August 2026 (buffer) | 🔲 Not started |

> **Note (3 Jun 2026):** Both backend and frontend phases completed ahead of schedule (both done by end of May). Testing phase started early — benchmark card completed June 3, unit tests 95% complete from backend phase.

**Deadline:** End of July 2026 (August is buffer for Prof. Vij review and final submission via university portal).

**After submission:** Short presentation session with a tutor. Prof. Vij announces final grade and provides feedback.

---

## Thesis Structure (agreed with Prof. Vij)

1. Introduction
2. System Requirements and Analysis
3. System Architecture and Design
4. Technology Stack and Implementation
   - DynamoDB single-table schema design with access patterns
   - REST API specification (endpoints, request/response formats)
   - Low-fidelity UI/UX wireframes for core screens
5. Testing and Quality Assurance
6. User Experience and Interface Design *(include only if applicable)*
7. Conclusion and Future Work
8. Appendices *(code snippets, test results, metrics)*

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React / Next.js (PWA) |
| Hosting | AWS CloudFront + S3 |
| API | AWS API Gateway (REST) |
| Compute | AWS Lambda (serverless) |
| Database | AWS DynamoDB (single-table design) |
| Storage | AWS S3 |
| Auth | AWS Cognito (JWT) |
| AI Integration | Anthropic Claude API |
| OCR | AWS Textract |
| Messaging | AWS SES + SNS |
| Scheduling | AWS EventBridge |
| IaC | AWS CDK (TypeScript) |

---

## Trello Labels

| Label | Color | Used for |
|---|---|---|
| `Documentation` | Sky (blue) | All doc deliverables |
| `Backend` | Green | AWS / Lambda / infrastructure |
| `AI Integration` | Orange | Claude API, Textract |
| `Frontend` | Pink | Next.js UI components |
| `Testing` | Yellow | Unit, integration, user validation |
| `Thesis Writing` | Purple | Thesis chapters |
| `Submission` | Lime | Review and final submission |

---

## Trello Cards – Full List

### 📝 Documentation — April

| Card | Due | Label |
|---|---|---|
| ✅ Software Requirements Specification (SRS) | 25 Apr | Documentation |
| ✅ System Architecture Diagrams | 26 Apr | Documentation |
| ✅ DynamoDB Single-Table Schema Design | 27 Apr | Documentation |
| ✅ REST API Specification | 28 Apr | Documentation |
| ✅ Low-Fidelity UI/UX Wireframes | 29 Apr | Documentation |
| ✅ Test Plan | 30 Apr | Documentation |

**Card details:**

**Software Requirements Specification (SRS)** – 25 Apr ✅ Completed
- Functional requirements
- Non-functional requirements (performance, scalability, security)
- User stories (artigiano role)
- Acceptance criteria

> ✅ Completed – 25 Apr 2026
> 📄 Document: CantiereSnap_SRS.docx (19 pages, 39 FRs, 19 NFRs, 16 user stories)
> 📄 GitHub: `/docs/CantiereSnap_SRS.md` (markdown version for repo)

**System Architecture Diagrams** – 26 Apr ✅ Completed
- High-level AWS architecture diagram
- AI pipeline flow (Claude API integration)
- Event-driven data flow diagram
- Auth flow (Cognito + JWT)

> ✅ Completed – 24 Apr 2026
> 📄 Files (GitHub repo `/docs/diagrams/`):
> - `01_high_level_aws_architecture.mermaid`
> - `02_ai_pipeline_flows.mermaid` (v2 — added FR-QUOTE-006 metadata logging, FR-PHOTO-003 Before/After tagging, FR-OCR-004 confidence check)
> - `03_event_driven_data_flow.mermaid` (v2 — added FR-DASH-001→004 monthly analytics aggregation, NFR-AVAIL-003 retry with exponential backoff)
> - `04_auth_flow_cognito_jwt.mermaid`

**DynamoDB Single-Table Schema Design** – 27 Apr ✅ Completed
- Define entities: Job, Client, Quote, Invoice, Photo
- Define primary keys (PK/SK)
- Define GSI for secondary access patterns
- Document all access patterns

> ✅ Completed – 27 Apr 2026
> 📄 Files (GitHub repo `/docs/`):
> - `05_dynamodb_schema_design.md` (v1.1 — 13 entities, 2 GSIs, 40 access patterns, transaction patterns, known limitations)
> - `05_dynamodb_entity_relationships.mermaid` (ER diagram)

**REST API Specification** – 28 Apr ✅ Completed
- Define all resource endpoints (Jobs, Clients, Quotes, Invoices)
- Request/response schemas (JSON)
- Auth headers (JWT Bearer)
- Error codes and messages

> ✅ Completed – 28 Apr 2026
> 📄 GitHub: `/docs/rest_api_specification.md` (37 endpoints, full traceability to 39 FRs and 40 DynamoDB access patterns, pagination, error handling, EventBridge automated triggers)

**Low-Fidelity UI/UX Wireframes** – 29 Apr ✅ Completed
- Login / Register screen
- Job Pipeline (Kanban view)
- Quote generation form
- Photo gallery per job
- Electronic invoice module
- Dashboard & Analytics

> ✅ Completed – 28 Apr 2026
> 📄 File: `CantiereSnap_Wireframes_bundle.html` (interactive lo-fi wireframes, 6 screens)
> 📄 GitHub: `/docs/wireframes/index.html` (for GitHub Pages rendering)
> 🔗 Screens: Login/Register (FR-AUTH-001), Job Pipeline Kanban (FR-JOB), AI Quote Generation (FR-QUOTE-001), Photo Gallery (FR-PHOTO-001), Electronic Invoice (FR-INV-001), Dashboard & Analytics (FR-DASH-001→005)

**Test Plan** – 30 Apr ✅ Completed
- Unit testing strategy (Lambda functions)
- Integration testing strategy (API Gateway)
- User validation protocol (5–10 tradespeople)
- Performance benchmarking plan (Lambda vs Fargate)
- Acceptance criteria definition

> ✅ Completed – 28 Apr 2026
> 📄 Document: CantiereSnap_Test_Plan.docx (8 sections: unit testing with Jest, integration testing with Postman/Newman, user validation protocol for 5–10 artigiani, Lambda vs Fargate benchmark, acceptance criteria matrix)
> 📄 GitHub: `/docs/CantiereSnap_Test_Plan.md` (markdown version for repo)

---

### 💻 Backend Development — May

| Card | Due | Label |
|---|---|---|
| ✅ AWS CDK – Infrastructure as Code | 5 May | Backend |
| ✅ DynamoDB Table + GSI Implementation | 7 May | Backend |
| ✅ Cognito User Pool – Authentication | 9 May | Backend |
| ✅ API Gateway + Lambda Scaffolding | 13 May | Backend |
| ✅ AI Quote Generation Pipeline (Claude API) | 17 May | AI Integration |
| ✅ Photo Upload – S3 + Presigned URLs | 20 May | Backend |
| ✅ Textract OCR – Receipts & Handwritten Notes | 23 May | AI Integration |
| ✅ SES/SNS – Email & SMS Notifications | 27 May | Backend |
| ✅ EventBridge – Scheduled Jobs | 30 May | Backend |

**Card details:**

**AWS CDK – Infrastructure as Code** – 5 May ✅ Completed
- CDK project setup (TypeScript)
- DynamoDB table + GSI stacks
- S3 buckets (photos, PDFs, XML)
- API Gateway + Lambda stack
- Cognito User Pool stack
- CloudFront distribution *(deferred to June — needed only for frontend hosting)*
- EventBridge rules
- SES/SNS configuration

> ✅ Completed – 11 May 2026
> 📂 GitHub: `/infra/` (5 CDK stacks: DataStack, AuthStack, ApiStack, NotificationStack, SchedulingStack)
> 🔀 All stacks deployed to staging (`eu-south-1`, account 491545415092)
> ⚠️ CloudFront distribution deferred to June frontend phase

**DynamoDB Table + GSI Implementation** – 7 May ✅ Completed
- Create table with PK/SK
- Add GSI-1 (by user/status)
- Add GSI-2 (by date)
- Seed test data
- Validate all access patterns

> ✅ Completed – 11 May 2026
> 📂 Table `CantiereSnapTable-staging` live in eu-south-1
> 📊 Access patterns validated via end-to-end lifecycle test: client creation, job CRUD, quote generation, photo upload, OCR materials, invoice creation with status transitions
> 📊 Test data seeded during integration testing (client, job with 14 quote items, 4 OCR materials, invoice with FatturaPA XML)

**Cognito User Pool – Authentication** – 9 May ✅ Completed
- Create User Pool and App Client
- Configure email verification
- Integrate JWT authoriser on API Gateway
- Test sign-up / sign-in / refresh flows

> ✅ Completed – 11 May 2026
> 📂 User Pool `eu-south-1_fztVWe2zw`, Client ID `49k1v94dcoe1jvikn41q00ro4m`
> 📊 Full auth flow tested end-to-end: register → email verification → login (ID token) → refresh token
> 🐛 Fixed: login handler returned AccessToken instead of IdToken (API Gateway Cognito authorizer requires ID tokens)

**API Gateway + Lambda Scaffolding** – 13 May ✅ Completed
- API Gateway REST API setup
- Lambda handler structure (one per resource)
- Input validation middleware
- Centralised error handling
- Logging (CloudWatch)
- Local testing with SAM CLI *(replaced by Jest — 307+ unit tests)*

> ✅ Completed – 11 May 2026
> 📂 API endpoint: `https://ec0ws3spi8.execute-api.eu-south-1.amazonaws.com/staging/`
> 📂 GitHub: `/backend/handlers/` (11 Lambda handlers), `/backend/shared/` (7 shared modules)
> 📊 307+ Jest unit tests (all passing), structured JSON logging to CloudWatch, centralised error handling via `shared/response.ts`
> ⚠️ SAM CLI local testing replaced by comprehensive Jest test suite with mocked AWS services

**AI Quote Generation Pipeline (Claude API)** – 17 May ✅ Completed
- Prompt engineering: system prompt for quote structure
- Lambda integration with Anthropic Claude API
- JSON schema enforcement for quote items
- PDF generation (pdfkit)
- Store PDF to S3
- Accuracy benchmarking vs manual quotes *(first datapoint collected; full benchmark in July)*

> ✅ Completed – 11 May 2026
> 📂 GitHub: `/backend/handlers/quotes.handler.ts`, `/backend/shared/anthropic.ts`
> 📊 End-to-end test: "Rifacimento bagno completo" → 14 line items, €8,624 total (realistic for Italian construction pricing)
> 📊 Quote PDF generated via pdfkit, stored in S3
> 🐛 Fixed: Lambda timeout 3s → 60s (AI calls take 20-26s), Claude JSON parsing (code fence handling), model updated to claude-sonnet-4-6
> ⚠️ Full accuracy benchmark (5-10 quotes vs manual) deferred to July user validation

**Photo Upload – S3 + Presigned URLs** – 20 May ✅ Completed
- S3 bucket with lifecycle policies
- Presigned URL generation Lambda
- Photo metadata stored in DynamoDB
- AI-generated technical descriptions (Claude API)
- S3 prefix structure: /jobs/{jobId}/photos/

> ✅ Completed – 11 May 2026
> 📂 GitHub: `/backend/handlers/photos.handler.ts`
> 📊 Two-step upload flow tested: presigned PUT URL → direct S3 upload → metadata save + Claude Vision description
> 🐛 Fixed: S3 CRC32 checksum header in presigned URLs (`requestChecksumCalculation: 'WHEN_REQUIRED'`), missing CDK route registrations for POST/GET/DELETE

**Textract OCR – Receipts & Handwritten Notes** – 23 May ✅ Completed
- Textract integration Lambda
- Parse extracted text into structured material cost entries
- Store to DynamoDB under job record
- Error handling for low-quality scans

> ✅ Completed – 11 May 2026
> 📂 GitHub: `/backend/handlers/ocr.handler.ts`, `/backend/shared/textract.ts`
> 📊 End-to-end test: receipt image → Textract extraction → Claude parsing → 4 structured material entries with confidence scoring (95%)
> 📊 Low-confidence items (< 80%) flagged with warning field; manual entries get confidence: 100, verified: true

**SES/SNS – Email & SMS Notifications** – 27 May ✅ Completed
- SES: send quote PDF via email
- SES: send invoice email
- SNS: SMS appointment reminders
- Email templates (HTML)

> ✅ Completed – 11 May 2026
> 📂 GitHub: `/backend/handlers/notification-sender.handler.ts`, `/backend/shared/ses.ts`, `/backend/shared/sns.ts`, `/backend/shared/email-templates.ts`
> 📊 Professional HTML email templates for: quote PDF, invoice, overdue reminder, invoice due reminder
> 📊 Structured JSON logging for all notification sends

**EventBridge – Scheduled Jobs** – 30 May ✅ Completed
- Overdue payment alert rule
- Invoice reminder rule (7 days before due)
- Monthly analytics aggregation

> ✅ Completed – 11 May 2026
> 📂 GitHub: `/backend/handlers/notification-sender.handler.ts` (overdue-alert + invoice-reminder), `/backend/handlers/monthly-analytics.handler.ts`
> 📂 Three EventBridge rules deployed: daily overdue alert, daily 7-day invoice reminder, monthly analytics (1st of month at 01:00)
> 📊 Batch processing with per-item error handling (single failure doesn't stop the batch)

---

# CantiereSnap – Frontend Development Status Update (18 May 2026)

> Update to the Frontend Development section of `CantiereSnap_Project_Planning.md`
> Replace the existing `### 🖥️ Frontend Development — June` section with the content below.

---

### 🖥️ Frontend Development — June

| Card | Due | Status | Label |
|---|---|---|---|
| Next.js PWA Setup | 3 Jun | ✅ Complete | Frontend |
| Auth Pages – Login & Registration | 6 Jun | ✅ Complete | Frontend |
| Job Pipeline – Kanban Board UI | 11 Jun | ✅ Complete | Frontend |
| AI Quote Generation Form | 15 Jun | ✅ Complete | Frontend |
| Photo Gallery – Per Job Documentation | 19 Jun | ✅ Complete | Frontend |
| Electronic Invoice Module (FatturaPA XML) | 24 Jun | ✅ Complete | Frontend |
| Dashboard & Analytics | 28 Jun | ✅ Complete | Frontend |

**Card details:**

**Next.js PWA Setup** – 3 Jun ✅ Completed
- Next.js project initialisation
- PWA manifest + service worker
- Tailwind CSS configuration
- API client setup (Axios / fetch)
- Environment variable management
- CI/CD pipeline (GitHub Actions → S3)

> ✅ Completed – 18 May 2026
> 📂 GitHub: `/frontend/` (31 files, 10 static pages)
> 📂 Key files: `lib/auth.tsx` (AuthProvider, useAuth, ID token storage), `lib/api-client.ts` (Axios + 401 refresh queue + fetchAllPages), `public/sw.js` (cache-first shell, network-first API), `.github/workflows/deploy-frontend.yml`
> 🐛 Claude Code adapted prompt: `getAccessToken()` → `getIdToken()` (read from CLAUDE.md that auth uses ID tokens), real staging URL wired from CLAUDE.md, SW hostname check instead of pathname for cross-origin API

**Auth Pages – Login & Registration** – 6 Jun ✅ Completed
- Login page
- Registration page
- Email verification flow
- JWT storage and refresh logic
- Protected route wrapper

> ✅ Completed – 18 May 2026
> 📂 GitHub: `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`, `app/(auth)/verify/page.tsx`, `components/ProtectedRoute.tsx`, `components/ui/{Input,Button,Alert}.tsx`
> 📊 Full auth flow tested end-to-end on staging: register → email verification → login → protected routes
> 🐛 Fixed: 401 interceptor was triggering token refresh on /auth/* endpoints (wrong password caused silent redirect instead of error message)
> 🐛 Fixed: .env.production had `/prod` stage (doesn't exist) → changed to `/staging`
> 🐛 Fixed: SW cache-fallback swallowed API errors → API calls now bypass SW entirely

**Job Pipeline – Kanban Board UI** – 11 Jun ✅ Completed
- Kanban board component
- Job card component (status, client, date)
- Status transition with timestamp
- Create new job modal
- Filter by status / date

> ✅ Completed – 18 May 2026
> 📂 GitHub: `app/(dashboard)/jobs/page.tsx`, `components/{JobCard,JobDetailPanel,CreateJobModal}.tsx`, `app/(dashboard)/layout.tsx` (dashboard shell with sidebar + responsive topbar)
> 📊 5-column Kanban (Preventivo → Fatturato), skeleton loading, status chips, date range filter, search with debounce
> 📊 Two-step job creation: client search/create → job details
> 🐛 Fixed (backend): GET /jobs without status param returned empty — GSI-1 had no Cancelled guard, soft-deleted jobs consumed Limit budget
> 🐛 Fixed (backend): Date range filter always empty — GSI-2 DueDateIndex had ProjectionType.INCLUDE missing critical fields (status, description). Rewrote to query StatusIndex with FilterExpression on targetDate
> 🐛 Fixed (backend): Cancelled jobs polluting GSI — deleteJob didn't update GSI1SK. Fix: update to `JOB#Cancelled#` on soft delete

**AI Quote Generation Form** – 15 Jun ✅ Completed
- Free-text job description input
- Loading state during AI generation
- Preview generated quote (itemised table)
- Edit / approve generated items
- Download / send PDF button

> ✅ Completed – 18 May 2026
> 📂 GitHub: `components/{QuoteGenerator,QuoteEditor}.tsx`, `lib/format.ts` (Italian number formatting)
> 📊 AI generation with 4-message cycling loading animation (15-25s Claude API call)
> 📊 Inline-editable table with click-to-edit cells, add/delete rows, IVA preview
> 📊 PDF finalize + download + send-to-client email form
> 🐛 Fixed: EditableCell defined inside QuoteEditor caused React remount on every re-render → extracted to top-level component
> 🐛 Fixed (backend): TransactWriteItems issued Delete + Put for same key when item count unchanged → skip Delete for reused keys
> 🐛 Fixed: Frontend kept stale seq numbers after backend re-sequencing → now replaces local state with server response after save
> ⚠️ PDF formatting is basic (cosmetic improvement deferred)
> ⚠️ Email send blocked by SES sandbox (staging limitation, not a bug)

**Photo Gallery – Per Job Documentation** – 19 Jun ✅ Completed
- Photo upload widget (presigned URL)
- Gallery grid per job
- Before / After tagging
- AI description display
- Lightbox viewer

> ✅ Completed – 18 May 2026
> 📂 GitHub: `components/{PhotoUpload,PhotoGallery,PhotoLightbox,MaterialsSection,ReceiptScanner}.tsx`
> 📊 3-step presigned URL upload flow (get URL → PUT to S3 → save metadata + AI description)
> 📊 Camera input with `capture="environment"` for on-site rear camera
> 📊 OCR receipt scanning via Claude Vision with confidence scoring
> 🐛 Fixed: S3 CORS missing on data bucket → added CORS rules in CDK DataStack
> 🐛 Fixed: Presigned URL signed without `x-amz-meta-tag` header → S3 returned 403 SignatureDoesNotMatch → 150-byte error XML saved instead of image. Frontend didn't check fetch response status.
> ⚠️ AI photo description display may need frontend fix (not showing in lightbox) — deferred to July testing

**Electronic Invoice Module (FatturaPA XML)** – 24 Jun ✅ Completed
- Invoice creation form (client data, line items)
- FatturaPA XML generation via backend
- XML preview / download
- Invoice status tracker (Sent, Paid, Overdue)
- Link invoice to job in pipeline

> ✅ Completed – 18 May 2026
> 📂 GitHub: `components/{InvoiceCreator,InvoiceViewer}.tsx`, `app/(dashboard)/invoices/page.tsx`, `app/(dashboard)/profile/page.tsx`
> 📊 Fully tested end-to-end: profile fiscal data saved → job advanced to Completed → invoice created → FatturaPA XML generated and downloaded
> 📊 Pre-flight profile check blocks invoice creation if fiscal data missing (Partita IVA, Codice Fiscale, Regime Fiscale)
> 📊 Invoice status tracker: Draft → Sent → Paid/Overdue with colored badges
> 📊 Profile settings page with Italian fiscal data (RF01/RF02/RF04/RF19 regime fiscale dropdown)

**Dashboard & Analytics** – 28 Jun ✅ Completed
- Monthly revenue chart
- Job completion rate
- Average quote-to-invoice time
- Materials cost breakdown
- Overdue invoices alert widget
- Date range filter

> ✅ Completed – 18 May 2026
> 📂 GitHub: `app/(dashboard)/analytics/page.tsx`, `components/dashboard/{KpiCard,RevenueChart,JobDistributionChart,OverdueWidget}.tsx`
> 📊 4 KPI cards (revenue, completion rate, avg quote-to-invoice days, overdue count)
> 📊 Recharts bar chart for monthly revenue, donut chart for job distribution by status
> 📊 Date range selector with quick presets (this month, 3/6/12 months)
> 📊 Parallel data fetching from 3 dashboard endpoints
> 🐛 Fixed: CORS missing on /dashboard/* endpoints → redeployed ApiStack

---

### Known Issues Deferred to July Testing

| Issue | Type | Priority |
|---|---|---|
| AI photo description not displayed in lightbox | Frontend | Medium |
| Email delivery blocked by SES sandbox | AWS Config | Low (staging only) |
| Quote PDF basic formatting | Cosmetic | Low |
| Job detail panel missing client/address fields (intermittent) | Frontend | Medium |
| Manual material addition (intermittent) | Frontend | Medium |

---

### Frontend Bug Count Summary

| Phase | Bugs Found | Bugs Fixed | Open |
|---|---|---|---|
| Backend (May) | 9 | 9 | 0 |
| Frontend (June) | 8 | 8 | 0 |
| Integration frontend↔backend | 5 | 5 | 0 |
| **Total** | **22** | **22** | **0 critical** |

> Note: 5 minor/cosmetic issues deferred to July testing phase (see table above).

---

---

### 🧪 Testing & Thesis — June–July

| Card | Due | Status | Label |
|---|---|---|---|
| Unit Tests – Lambda Functions | 4 Jul | ✅ Complete (377 tests, all passing) | Testing |
| Integration Tests – REST API | 8 Jul | ✅ Complete (3 Jun 2026) | Testing |
| User Validation – 5–10 Local Tradespeople | 12 Jul | 🔲 Not started | Testing |
| Performance Benchmark – Lambda vs Fargate | 15 Jul | ✅ Complete (3 Jun 2026) | Testing |
| Thesis – Chapters 1 & 2 (Intro + Requirements) | 18 Jul | 🔲 Not started | Thesis Writing |
| Thesis – Chapters 3 & 4 (Architecture + Tech Stack) | 22 Jul | 🔲 Not started | Thesis Writing |
| Thesis – Chapters 5–7 + Appendices | 26 Jul | 🔲 Not started | Thesis Writing |

**Card details:**

**Unit Tests – Lambda Functions** – 4 Jul ✅ Completed (ahead of schedule)
- Jest setup
- Tests for quote generation handler
- Tests for invoice handler
- Tests for job CRUD handlers
- Tests for OCR handler
- Coverage report (target >80%)

> ✅ Completed – 11 May 2026 (during backend phase)
> 📊 377 tests across 13 suites, all passing. Coverage: 93.75% statements, 94.76% lines. Auth 52, Jobs 49, Clients 31, Quotes 44, Photos 37, OCR 40, Invoices 31, Dashboard 23, Notifications 17, NotificationSender 12, MonthlyAnalytics 11, Logger 5, EmailTemplates 25.
> 📂 GitHub: `/backend/handlers/*.test.ts`, `__fixtures__/` directories

**Integration Tests – REST API** – 8 Jul ✅ Completed (3 Jun 2026 — ahead of schedule)
- Postman collection for all endpoints
- Auth flow tests
- Job lifecycle tests (create → invoice)
- Error handling tests
- Newman CI pipeline integration

> ✅ Completed – 3 Jun 2026
> 📂 GitHub: `/tests/postman/` (Postman collection + Newman runner + GitHub Actions workflow)
> 📊 43 requests, 126 assertions, 0 failures. Full job lifecycle tested end-to-end on staging in 1m 10s.
> 📊 AI quote generation tested with async 202 + polling pattern (refactored during integration testing to overcome API Gateway 29s hard timeout)
> 📊 9 test folders: Auth Flow, Clients, Job Lifecycle, AI Quote Generation, Status Transitions, Invoice, Dashboard, Error Handling, Cleanup
> 📊 Newman CI workflow configured in GitHub Actions (manual trigger + weekly Monday schedule)
> 🐛 Fixed during integration testing: async quote generation (Lambda self-invocation), max_tokens 1500→4096 (truncated JSON), quote finalize auto-advances job status

**User Validation – 5–10 Local Tradespeople** – 12 Jul
- Recruit 5–10 Italian micro-enterprise tradespeople
- Define user validation protocol
- Conduct sessions (observe task completion)
- Collect feedback on quote generation accuracy
- Document findings

**Performance Benchmark – Lambda vs Fargate** – 15 Jul ✅ Completed (3 Jun 2026 — ahead of schedule)
- Deploy equivalent workload on Fargate
- Measure cold-start latency (Lambda)
- Measure warm latency under sustained and spike load
- Measure AI quote generation time-to-data
- Measure cost per 1000 requests
- Measure developer experience (subjective)
- Tabulate and chart results for thesis

> ✅ Completed – 3 Jun 2026
> 📂 GitHub: `/tests/benchmark/` (Artillery configs, run script, cost calculator, results)
> 📊 Results file: `tests/benchmark/results/RESULTS_TEMPLATE.md`
>
> **Key results (RQ3):**
> - Warm latency: Fargate 5–6× faster (median 32 ms vs 153 ms overall)
> - Cold start: Lambda p99 = 2,322 ms; Fargate = none
> - Spike (50 rps): Lambda 8.8% errors, Fargate 0%
> - AI generation time-to-data: Lambda 61.7 s (async+poll), Fargate 24.6 s (sync)
> - Cost at 10,000 req/day: Lambda $0.42/month vs Fargate $18.02/month
> - Break-even: ~430,000 req/day (far beyond CantiereSnap target scale)
> - **Recommendation:** Lambda is correct for CantiereSnap (<10,000 req/day); Fargate justified only for AI-heavy sync workloads or >430K req/day
>
> **Infrastructure note:** Fargate benchmark stack deployed via CDK (`CantiereSnap-BenchmarkStack`), destroyed after test to avoid ongoing cost. Docker image built from same Lambda handler code with Express adapter (`tests/benchmark/fargate-app/`). Benchmark ran against shared staging DynamoDB table + S3 bucket.

**Thesis – Chapters 1 & 2** – 18 Jul
- Ch.1 Introduction: problem statement, research questions, scope
- Ch.2 System Requirements and Analysis: SRS summary, user stories, constraints

**Thesis – Chapters 3 & 4** – 22 Jul
- Ch.3 System Architecture and Design
- Ch.4 Technology Stack and Implementation (DynamoDB schema, API spec, wireframes)

**Thesis – Chapters 5–7 + Appendices** – 26 Jul
- Ch.5 Testing and Quality Assurance
- Ch.6 User Experience and Interface Design
- Ch.7 Conclusion and Future Work
- Appendices (code snippets, test results, metrics)
- Abstract + bibliography

---

### 🚀 Review & Submission — August (buffer)

| Card | Due | Label |
|---|---|---|
| Final Review with Prof. Vij | 5 Aug | Submission |
| Post-Feedback Revisions | 15 Aug | Submission |
| University Portal Submission | 20 Aug | Submission |
| Final Presentation Session | 25 Aug | Submission |

**Card details:**

**Final Review with Prof. Vij** – 5 Aug
- Compile full draft (all chapters)
- Self-review and proofreading
- Send to Prof. Vij
- Await feedback

**Post-Feedback Revisions** – 15 Aug
- Address all supervisor feedback
- Final proofread
- Format check (OPIT guidelines)
- Final version approved by supervisor

**University Portal Submission** – 20 Aug
- Upload final thesis PDF
- Upload any required attachments
- Confirm submission acknowledgement

**Final Presentation Session** – 25 Aug
- Prepare presentation slides
- Prepare live demo of CantiereSnap
- Rehearse Q&A
- Confirm date/time with Prof. Vij

---

## How to Use Trello

- When a card is **completed**: move it to the **Completed** column and tick all checklist items
- Add links in the card description using this format:

```
✅ Completed – [date]
📄 Document: https://drive.google.com/...   ← for documentation cards (docx)
📂 GitHub: https://github.com/...           ← for docs in repo (md, mermaid)
🔀 PR: https://github.com/...              ← for backend/frontend cards
📊 Report: https://github.com/...          ← for testing cards
📝 Draft: https://drive.google.com/...     ← for thesis cards
```

- Use **card comments** for quick notes (e.g. "waiting for Prof. Vij feedback", "blocked by X")

---

## Research Questions

- **RQ1:** How can a serverless AWS architecture deliver a full-lifecycle job management app for micro-enterprises at near-zero operational cost?
- **RQ2:** To what extent can LLM APIs automate structured document generation (quotes, invoices) from unstructured natural-language input?
- **RQ3:** What are the architectural trade-offs (latency, cost, reliability) of a fully serverless stack vs container-based alternatives?

---

## Integration Testing Results — May 11, 2026

Full end-to-end lifecycle validated on staging environment:

| Step | Endpoint | Result |
|---|---|---|
| Register | POST /auth/register | ✅ Cognito user created + DynamoDB profile |
| Verify email | POST /auth/verify | ✅ Code confirmed |
| Login | POST /auth/login | ✅ ID token + refresh token returned |
| Refresh token | POST /auth/refresh | ✅ New access token issued |
| Create client | POST /clients | ✅ Client saved to DynamoDB |
| Create job | POST /jobs | ✅ Job created with auto-incremented ID |
| Generate AI quote | POST /jobs/00001/quote | ✅ 14 items, €8,624 total (Claude Sonnet) |
| Approve quote | POST /jobs/00001/quote/finalize | ✅ Status → Accepted |
| Generate PDF | POST /jobs/00001/quote/send | ✅ PDF in S3 (after pdfkit font fix) |
| Upload photo | POST /photos/upload-url → PUT S3 → POST /photos | ✅ Presigned URL flow works |
| OCR scan | POST /jobs/00001/materials/scan | ✅ 4 materials parsed, confidence 95% |
| Advance status | PATCH /jobs/00001/status (InProgress → Completed) | ✅ State machine validated |
| Create invoice | POST /jobs/00001/invoice | ✅ FatturaPA XML in S3, €10,521.28 inc. VAT |

### Bugs Found and Fixed During Integration
| Bug | Root Cause | Fix |
|---|---|---|
| Login token rejected by API Gateway | Handler returned AccessToken, authorizer requires IdToken | Switched to `auth.IdToken` |
| Quote endpoint not found | CDK route `/quote/generate` vs handler route `/quote` | Added `/generate` route case |
| AI service unavailable (404) | Model `claude-sonnet-4-20250514` deprecated | Updated to `claude-sonnet-4-6` |
| AI service timeout | Lambda default 3s, AI calls take 20-26s | Set timeout to 60s on quotesFn and ocrFn |
| AI JSON parse error | Claude wraps JSON in code fences | Fixed parser to use indexOf/lastIndexOf |
| Photo POST route missing | CDK didn't register POST /photos | Added missing route |
| S3 presigned URL rejected | CRC32 checksum header in signed URL | Set `requestChecksumCalculation: 'WHEN_REQUIRED'` |
| PDF font missing | esbuild doesn't copy pdfkit .afm files | Added afterBundling hook to copy font data |
| Env var mismatch | CDK `USER_POOL_CLIENT_ID` vs handler `CLIENT_ID` | Renamed to `CLIENT_ID` |