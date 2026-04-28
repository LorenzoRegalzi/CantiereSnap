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
| Documentation | April 2026 | ✅ Nearly complete (5/6 cards done) |
| Backend Development | May 2026 | 🔲 Not started |
| Frontend Development | June 2026 | 🔲 Not started |
| Testing & Thesis Writing | July 2026 | 🔲 Not started |
| Review & Submission | August 2026 (buffer) | 🔲 Not started |

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
| Test Plan | 30 Apr | Documentation |

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

**Test Plan** – 30 Apr
- Unit testing strategy (Lambda functions)
- Integration testing strategy (API Gateway)
- User validation protocol (5–10 tradespeople)
- Performance benchmarking plan (Lambda vs Fargate)
- Acceptance criteria definition

---

### 💻 Backend Development — May

| Card | Due | Label |
|---|---|---|
| AWS CDK – Infrastructure as Code | 5 May | Backend |
| DynamoDB Table + GSI Implementation | 7 May | Backend |
| Cognito User Pool – Authentication | 9 May | Backend |
| API Gateway + Lambda Scaffolding | 13 May | Backend |
| AI Quote Generation Pipeline (Claude API) | 17 May | AI Integration |
| Photo Upload – S3 + Presigned URLs | 20 May | Backend |
| Textract OCR – Receipts & Handwritten Notes | 23 May | AI Integration |
| SES/SNS – Email & SMS Notifications | 27 May | Backend |
| EventBridge – Scheduled Jobs | 30 May | Backend |

**Card details:**

**AWS CDK – Infrastructure as Code** – 5 May
- CDK project setup (TypeScript)
- DynamoDB table + GSI stacks
- S3 buckets (photos, PDFs, XML)
- API Gateway + Lambda stack
- Cognito User Pool stack
- CloudFront distribution
- EventBridge rules
- SES/SNS configuration

**DynamoDB Table + GSI Implementation** – 7 May
- Create table with PK/SK
- Add GSI-1 (by user/status)
- Add GSI-2 (by date)
- Seed test data
- Validate all access patterns

**Cognito User Pool – Authentication** – 9 May
- Create User Pool and App Client
- Configure email verification
- Integrate JWT authoriser on API Gateway
- Test sign-up / sign-in / refresh flows

**API Gateway + Lambda Scaffolding** – 13 May
- API Gateway REST API setup
- Lambda handler structure (one per resource)
- Input validation middleware
- Centralised error handling
- Logging (CloudWatch)
- Local testing with SAM CLI

**AI Quote Generation Pipeline (Claude API)** – 17 May
- Prompt engineering: system prompt for quote structure
- Lambda integration with Anthropic Claude API
- JSON schema enforcement for quote items
- PDF generation (puppeteer / pdfkit)
- Store PDF to S3
- Accuracy benchmarking vs manual quotes

**Photo Upload – S3 + Presigned URLs** – 20 May
- S3 bucket with lifecycle policies
- Presigned URL generation Lambda
- Photo metadata stored in DynamoDB
- AI-generated technical descriptions (Claude API)
- S3 prefix structure: /jobs/{jobId}/photos/

**Textract OCR – Receipts & Handwritten Notes** – 23 May
- Textract integration Lambda
- Parse extracted text into structured material cost entries
- Store to DynamoDB under job record
- Error handling for low-quality scans

**SES/SNS – Email & SMS Notifications** – 27 May
- SES: send quote PDF via email
- SES: send invoice email
- SNS: SMS appointment reminders
- Email templates (HTML)

**EventBridge – Scheduled Jobs** – 30 May
- Overdue payment alert rule
- Invoice reminder rule (7 days before due)
- Monthly analytics aggregation

---

### 🖥️ Frontend Development — June

| Card | Due | Label |
|---|---|---|
| Next.js PWA Setup | 3 Jun | Frontend |
| Auth Pages – Login & Registration | 6 Jun | Frontend |
| Job Pipeline – Kanban Board UI | 11 Jun | Frontend |
| AI Quote Generation Form | 15 Jun | Frontend |
| Photo Gallery – Per Job Documentation | 19 Jun | Frontend |
| Electronic Invoice Module (FatturaPA XML) | 24 Jun | Frontend |
| Dashboard & Analytics | 28 Jun | Frontend |

**Card details:**

**Next.js PWA Setup** – 3 Jun
- Next.js project initialisation
- PWA manifest + service worker
- Tailwind CSS configuration
- API client setup (Axios / fetch)
- Environment variable management
- CI/CD pipeline (GitHub Actions → S3)

**Auth Pages – Login & Registration** – 6 Jun
- Login page
- Registration page
- Email verification flow
- JWT storage and refresh logic
- Protected route wrapper

**Job Pipeline – Kanban Board UI** – 11 Jun
- Kanban board component
- Job card component (status, client, date)
- Status transition with timestamp
- Create new job modal
- Filter by status / date

**AI Quote Generation Form** – 15 Jun
- Free-text job description input
- Loading state during AI generation
- Preview generated quote (itemised table)
- Edit / approve generated items
- Download / send PDF button

**Photo Gallery – Per Job Documentation** – 19 Jun
- Photo upload widget (presigned URL)
- Gallery grid per job
- Before / After tagging
- AI description display
- Lightbox viewer

**Electronic Invoice Module (FatturaPA XML)** – 24 Jun
- Invoice creation form (client data, line items)
- FatturaPA XML generation via backend
- XML preview / download
- Invoice status tracker (Sent, Paid, Overdue)
- Link invoice to job in pipeline

**Dashboard & Analytics** – 28 Jun
- Monthly revenue chart
- Job completion rate
- Average quote-to-invoice time
- Materials cost breakdown
- Overdue invoices alert widget
- Date range filter

---

### 🧪 Testing & Thesis — July

| Card | Due | Label |
|---|---|---|
| Unit Tests – Lambda Functions | 4 Jul | Testing |
| Integration Tests – REST API | 8 Jul | Testing |
| User Validation – 5–10 Local Tradespeople | 12 Jul | Testing |
| Performance Benchmark – Lambda vs Fargate | 15 Jul | Testing |
| Thesis – Chapters 1 & 2 (Intro + Requirements) | 18 Jul | Thesis Writing |
| Thesis – Chapters 3 & 4 (Architecture + Tech Stack) | 22 Jul | Thesis Writing |
| Thesis – Chapters 5–7 + Appendices | 26 Jul | Thesis Writing |

**Card details:**

**Unit Tests – Lambda Functions** – 4 Jul
- Jest setup
- Tests for quote generation handler
- Tests for invoice handler
- Tests for job CRUD handlers
- Tests for OCR handler
- Coverage report (target >80%)

**Integration Tests – REST API** – 8 Jul
- Postman collection for all endpoints
- Auth flow tests
- Job lifecycle tests (create → invoice)
- Error handling tests
- Newman CI pipeline integration

**User Validation – 5–10 Local Tradespeople** – 12 Jul
- Recruit 5–10 Italian micro-enterprise tradespeople
- Define user validation protocol
- Conduct sessions (observe task completion)
- Collect feedback on quote generation accuracy
- Document findings

**Performance Benchmark – Lambda vs Fargate** – 15 Jul
- Deploy equivalent workload on Fargate
- Measure cold-start latency (Lambda)
- Measure cost per 1000 requests
- Measure developer experience (subjective)
- Tabulate and chart results for thesis

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