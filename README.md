# 🏗️ CantiereSnap

**From jobsite to invoice — in a snap.**

An AI-augmented, serverless cloud platform for micro-enterprise job management in the Italian construction sector. Built as a BSc capstone project at OPIT (Open Institute of Technology).

[![Unit Tests](https://img.shields.io/badge/tests-377%20passing-brightgreen)]()
[![Integration Tests](https://img.shields.io/badge/integration-126%20assertions%20✓-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-93.75%25-brightgreen)]()
[![Deploy](https://img.shields.io/badge/staging-live-blue)](https://d1cs7qv0huouj3.cloudfront.net)

---

## The Problem

Italian micro-enterprise tradespeople — plumbers, electricians, tilers — manage their jobs with paper notebooks, WhatsApp messages, and Excel spreadsheets. No affordable digital tools exist for businesses with fewer than 10 employees. Creating a quote takes hours of manual calculation. Electronic invoicing (FatturaPA) is legally required but technically complex. Job site documentation is scattered across phone galleries.

## The Solution

CantiereSnap digitises the entire job lifecycle in one mobile-first PWA:

1. **Create a job** — describe the work in plain Italian
2. **Generate a quote** — AI reads your description and produces an itemised quote in seconds
3. **Document the site** — take before/after photos, AI generates technical descriptions
4. **Scan receipts** — photograph material receipts, AI extracts costs automatically
5. **Issue an invoice** — generate FatturaPA-compliant XML with one click
6. **Track your business** — analytics dashboard with revenue, completion rates, overdue alerts

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (PWA, static export) |
| Hosting | AWS S3 + CloudFront |
| API | AWS API Gateway (REST, 37 endpoints) |
| Compute | AWS Lambda (Node.js 20, TypeScript) |
| Database | AWS DynamoDB (single-table, 13 entities) |
| Auth | AWS Cognito (JWT) |
| AI | Anthropic Claude API (quote generation, photo descriptions, OCR) |
| Invoicing | FatturaPA XML v1.2 |
| IaC | AWS CDK (5 stacks, TypeScript) |
| CI/CD | GitHub Actions |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Next.js   │────▶│ API Gateway  │────▶│   Lambda    │
│   PWA       │     │  + Cognito   │     │  Handlers   │
│  (S3+CF)    │     │  Authorizer  │     │  (11 fns)   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌───────────────────────────┼───────────────┐
                    │                           │               │
              ┌─────▼─────┐            ┌───────▼──────┐  ┌────▼────┐
              │ DynamoDB  │            │     S3       │  │ Claude  │
              │ Single    │            │  Photos,     │  │   API   │
              │ Table     │            │  PDFs, XML   │  │  (AI)   │
              └───────────┘            └──────────────┘  └─────────┘
```

**CDK Stack Dependencies:**
```
DataStack ──────┐
                ├──▶ ApiStack ──────────┐
AuthStack ──────┘                       ├──▶ SchedulingStack
DataStack ──▶ NotificationStack ────────┘
```

---

## Project Structure

```
CantiereSnap/
├── backend/
│   ├── handlers/          # 11 Lambda handlers + tests
│   │   ├── auth.handler.ts
│   │   ├── jobs.handler.ts
│   │   ├── clients.handler.ts
│   │   ├── quotes.handler.ts
│   │   ├── photos.handler.ts
│   │   ├── ocr.handler.ts
│   │   ├── invoices.handler.ts
│   │   ├── dashboard.handler.ts
│   │   ├── notifications.handler.ts
│   │   ├── notification-sender.handler.ts
│   │   └── monthly-analytics.handler.ts
│   └── shared/            # Reusable modules (DynamoDB, S3, SES, etc.)
├── frontend/
│   ├── app/               # Next.js App Router
│   │   ├── (auth)/        # Login, Register, Verify
│   │   └── (dashboard)/   # Jobs, Quotes, Invoices, Photos, Analytics, Profile
│   ├── components/        # React components
│   └── lib/               # API client, auth, utilities
├── infra/
│   └── lib/stacks/        # CDK stacks (Data, Auth, Api, Notification, Scheduling, Frontend)
├── tests/
│   ├── postman/           # Integration tests (Newman)
│   └── benchmark/         # Lambda vs Fargate performance benchmark
└── Documentation/         # SRS, API spec, schema design, wireframes, test plan
```

---

## Key Features

### AI Quote Generation
Describe a job in plain Italian → Claude API generates a structured, itemised quote with realistic pricing for the Italian construction market. Async architecture (202 + polling) handles the 15-25 second AI processing time.

### Photo Documentation
Upload before/after photos directly from the phone camera. Claude Vision generates technical descriptions automatically. Photos stored via presigned URL flow (no Lambda compute for binary uploads).

### OCR Receipt Scanning
Photograph a material receipt → Claude Vision extracts item names, quantities, and costs. Confidence scoring flags uncertain extractions for human review.

### FatturaPA Electronic Invoicing
Generate compliant Italian electronic invoice XML (v1.2) with correct fiscal data, VAT calculations, and line items pulled from the approved quote.

### Analytics Dashboard
Monthly revenue charts, job completion rates, average quote-to-invoice time, overdue invoice alerts. Pre-aggregated historical data + live current-month calculations.

---

## Research Questions

This project addresses three research questions for the BSc thesis:

| # | Question | Key Finding |
|---|---|---|
| **RQ1** | Can a serverless architecture deliver a full-lifecycle app at near-zero cost? | **Yes.** Total cost for a single-user micro-enterprise: ~€0.50-3/month (almost entirely Claude API usage). |
| **RQ2** | Can LLMs automate structured document generation from natural language? | **Yes.** Claude generates 12-15 item quotes from plain Italian descriptions. Human-in-the-loop pattern for validation. |
| **RQ3** | What are the trade-offs of serverless vs containers? | Lambda is 40× cheaper at micro-enterprise scale ($0.42 vs $18.02/month at 10K req/day). Fargate is 5× faster (32ms vs 153ms median) with 0% errors under spike load. Break-even at ~430K req/day. |

---

## Performance Benchmark (Lambda vs Fargate)

| Metric | Lambda | Fargate |
|---|---|---|
| GET /jobs median | 176 ms | 28 ms |
| POST /jobs median | 118 ms | 34 ms |
| Error rate (50 rps spike) | 8.8% | 0% |
| AI quote time-to-data | 61.7s (async) | 24.6s (sync) |
| Cost at 10K req/day | $0.42/month | $18.02/month |

---

## Testing

| Level | Tool | Results |
|---|---|---|
| Unit | Jest | 377 tests, 93.75% statement coverage |
| Integration | Postman + Newman | 126 assertions, 0 failures, full lifecycle |
| Performance | Artillery | Lambda vs Fargate benchmark (2850 req/platform) |
| User Validation | In-person sessions | Scheduled (5-10 Italian tradespeople) |

---

## Getting Started

### Prerequisites
- Node.js 20+
- AWS CLI configured
- AWS CDK installed (`npm install -g aws-cdk`)

### Backend (already deployed to staging)
```bash
cd backend
npm install
npm test                    # Run 377 unit tests
```

### Frontend (local development)
```bash
cd frontend
npm install
npm run dev                 # Start dev server on localhost:3000
```

### Infrastructure
```bash
cd infra
npm install
npx cdk deploy --all --context env=staging
```

### Integration Tests
```bash
cd tests/postman
npm install -g newman
TEST_PASSWORD=<password> bash run-tests.sh
```

---

## Staging Environment

| Resource | Value |
|---|---|
| Frontend | https://d1cs7qv0huouj3.cloudfront.net |
| API | https://ec0ws3spi8.execute-api.eu-south-1.amazonaws.com/staging/ |
| Region | eu-south-1 (Milan) |

---

## Author

**Lorenzo Regalzi** — BSc Modern Computer Science, OPIT (Open Institute of Technology)

Supervisor: Prof. Lokesh Vij

Capstone Project — 5th Term, Fast-Track — 2026

---

## License

This project is part of an academic capstone. All rights reserved.