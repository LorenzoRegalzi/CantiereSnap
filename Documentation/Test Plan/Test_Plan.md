# CantiereSnap — Test Plan

| | |
|---|---|
| **Version** | 1.0 |
| **Date** | 30 April 2026 |
| **Author** | Lorenzo Regalzi |
| **Supervisor** | Prof. Lokesh Vij |
| **Program** | OPIT — BSc Modern Computer Science |
| **Status** | Draft |

Capstone Project — 5th Term, Fast-Track

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 30 Apr 2026 | Lorenzo Regalzi | Initial draft |

---

## Table of Contents

- [1. Introduction](#1-introduction)
  - [1.1 Scope](#11-scope)
  - [1.2 Objectives](#12-objectives)
  - [1.3 References](#13-references)
  - [1.4 Testing Timeline](#14-testing-timeline)
- [2. Unit Testing Strategy](#2-unit-testing-strategy)
  - [2.1 Framework and Tooling](#21-framework-and-tooling)
  - [2.2 Coverage Target](#22-coverage-target)
  - [2.3 Test Scope by Handler](#23-test-scope-by-handler)
  - [2.4 Mocking Strategy](#24-mocking-strategy)
  - [2.5 Test Data Management](#25-test-data-management)
- [3. Integration Testing Strategy](#3-integration-testing-strategy)
  - [3.1 Framework and Tooling](#31-framework-and-tooling)
  - [3.2 Authentication Flow Tests](#32-authentication-flow-tests)
  - [3.3 Job Lifecycle Tests](#33-job-lifecycle-tests)
  - [3.4 Error Handling Tests](#34-error-handling-tests)
  - [3.5 CI Pipeline Integration](#35-ci-pipeline-integration)
- [4. User Validation Protocol](#4-user-validation-protocol)
  - [4.1 Participant Recruitment](#41-participant-recruitment)
  - [4.2 Session Structure](#42-session-structure)
  - [4.3 Task Set](#43-task-set)
  - [4.4 Quote Accuracy Benchmark](#44-quote-accuracy-benchmark)
  - [4.5 Success Criteria](#45-success-criteria)
  - [4.6 Data Handling and Ethics](#46-data-handling-and-ethics)
- [5. Performance Benchmark: Lambda vs Fargate](#5-performance-benchmark-lambda-vs-fargate)
  - [5.1 Benchmark Design](#51-benchmark-design)
  - [5.2 Metrics](#52-metrics)
  - [5.3 Environment Configuration](#53-environment-configuration)
  - [5.4 Execution Protocol](#54-execution-protocol)
  - [5.5 Expected Outcome](#55-expected-outcome)
- [6. Acceptance Criteria Matrix](#6-acceptance-criteria-matrix)
- [7. Tools and Infrastructure Summary](#7-tools-and-infrastructure-summary)
- [8. Risks and Mitigations](#8-risks-and-mitigations)

---

## 1. Introduction

This document defines the testing strategy for CantiereSnap across four levels: unit testing, integration testing, user validation, and performance benchmarking. Each level targets a distinct quality concern, and together they provide confidence that the system meets its 39 functional requirements and 19 non-functional requirements as defined in the Software Requirements Specification (SRS v1.0, 25 April 2026).

### 1.1 Scope

The test plan covers all backend Lambda functions, the REST API surface (37 endpoints), the AI-powered quote generation pipeline, and the end-to-end job lifecycle. Frontend testing is excluded from this plan and will be addressed during the frontend development phase in June 2026.

### 1.2 Objectives

The testing phase pursues four objectives. First, verify that each Lambda function produces correct output for valid input and fails gracefully for invalid input, with a minimum code coverage target of 80%. Second, confirm that the REST API behaves according to the API specification across the full job lifecycle, including authentication, error handling, and pagination. Third, validate the system with 5–10 real *artigiani* (Italian micro-enterprise tradespeople) to measure task completion rates and quote generation accuracy. Fourth, benchmark Lambda's cost and latency characteristics against an equivalent AWS Fargate deployment to support the thesis's architectural trade-off analysis (RQ3).

### 1.3 References

- SRS v1.0 (25 Apr 2026) — 39 FRs, 19 NFRs, 16 user stories
- REST API Specification v1.0 (28 Apr 2026) — 37 endpoints
- DynamoDB Schema Design v1.1 (27 Apr 2026) — 13 entities, 40 access patterns
- System Architecture Diagrams v2 (24 Apr 2026) — 4 Mermaid diagrams

### 1.4 Testing Timeline

| Activity | Due Date | Duration | Dependency |
|----------|----------|----------|------------|
| Unit Tests — Lambda Functions | 4 Jul 2026 | 5 days | Backend complete |
| Integration Tests — REST API | 8 Jul 2026 | 4 days | Unit tests pass |
| User Validation — Tradespeople | 12 Jul 2026 | 4 days | Frontend complete |
| Performance Benchmark | 15 Jul 2026 | 3 days | Integration tests pass |

---

## 2. Unit Testing Strategy

Unit tests validate individual Lambda function handlers in isolation. Each handler is tested against its expected input/output contract, with external dependencies (DynamoDB, S3, Claude API, Textract) mocked to ensure deterministic, fast execution.

### 2.1 Framework and Tooling

The project uses **Jest** as the test runner and assertion library. Jest provides built-in mocking capabilities (`jest.mock()`), snapshot testing, and code coverage reporting via Istanbul. Tests are written in TypeScript alongside the Lambda handler source files, using the naming convention `{handler}.test.ts`.

### 2.2 Coverage Target

The minimum acceptable code coverage is 80% across lines, branches, functions, and statements. Coverage is measured by Jest's built-in Istanbul integration and reported in both text (terminal) and lcov (CI artifact) formats. Handlers containing only boilerplate wiring (e.g., middleware setup) may be excluded via coverage ignore comments, but business logic functions must meet the threshold individually.

### 2.3 Test Scope by Handler

| Handler | SRS Requirements | Key Scenarios | Mocked Services |
|---------|-----------------|---------------|-----------------|
| Job CRUD | `FR-JOB-001`–`006` | Create, read, update status, list with pagination, filter by status | DynamoDB |
| Client CRUD | `FR-JOB-001` | Create, list, update, search by name | DynamoDB |
| Quote Generation | `FR-QUOTE-001`–`006` | Valid input → structured items, token limits enforced, PDF generated, metadata logged | Claude API, S3, DynamoDB |
| Quote Management | `FR-QUOTE-003`–`005` | Edit line items, finalize, recalculate totals, send via email | DynamoDB, S3, SES |
| Photo Upload | `FR-PHOTO-001`–`005` | Presigned URL generation, metadata storage, AI description trigger, Before/After tagging | S3, DynamoDB, Claude API |
| OCR Processing | `FR-OCR-001`–`004` | Receipt parsing, structured output, low-confidence warning (<80%) | Textract, DynamoDB |
| Invoice Generation | `FR-INV-001`–`005` | FatturaPA XML schema compliance, pre-fill from quote, status transitions | DynamoDB, S3, SES |
| Dashboard Metrics | `FR-DASH-001`–`006` | Revenue calculation, completion rate, overdue detection, date range filtering | DynamoDB |
| Notifications | `FR-NOTIFY-001`–`002` | Overdue alert trigger, 7-day reminder, email template rendering | SES, SNS, DynamoDB |

### 2.4 Mocking Strategy

All AWS SDK calls are mocked using `jest.mock()` applied to the AWS SDK v3 client modules (`@aws-sdk/client-dynamodb`, `@aws-sdk/client-s3`, etc.). The Claude API client is mocked at the HTTP level, returning pre-recorded JSON responses that match the expected structured output schema. This approach ensures tests run without network access, execute in under 5 seconds per suite, and produce repeatable results.

DynamoDB mocks return realistic item shapes matching the single-table schema design (v1.1). For transactional operations (e.g., job status transitions requiring both a job header update and a status history entry), mocks validate that `TransactWriteItems` receives the correct item set.

### 2.5 Test Data Management

Test fixtures are stored in a `__fixtures__` directory alongside each handler's test file. Fixtures include sample DynamoDB items (matching the schema design's sample items from Section 7), Claude API response payloads, Textract output samples, and *FatturaPA* XML reference files. Each fixture is a JSON file loaded at test setup time, avoiding hardcoded values in test bodies.

---

## 3. Integration Testing Strategy

Integration tests verify that the REST API endpoints behave correctly when all components are wired together: API Gateway routing, Lambda execution, DynamoDB reads/writes, S3 operations, and Cognito JWT authorisation. These tests run against a deployed staging environment on AWS, not against mocks.

### 3.1 Framework and Tooling

The project uses **Postman** for interactive API testing and **Newman** (Postman's CLI runner) for automated CI execution. The Postman collection is version-controlled in the GitHub repository under `/tests/postman/`. Newman runs as a GitHub Actions step after unit tests pass, generating an HTML report stored as a CI artifact.

### 3.2 Authentication Flow Tests

The integration suite begins with authentication. A test user registers via `POST /auth/register`, confirms their email via `POST /auth/verify` (using a pre-seeded Cognito verification code in the staging pool), and obtains a JWT via `POST /auth/login`. The JWT is stored as a Postman collection variable and injected into the Authorization header of all subsequent requests. Token refresh (`POST /auth/refresh`) is tested separately by waiting for token expiry and verifying a new token is issued.

### 3.3 Job Lifecycle Tests

The core integration scenario exercises the full job lifecycle as a single, sequential flow, mirroring the tradesperson's real workflow:

1. Create a client (`POST /clients`).
2. Create a job linked to that client (`POST /jobs`).
3. Generate a quote from a natural-language description (`POST /jobs/{jobId}/quote/generate`).
4. Edit a quote line item (`PUT /jobs/{jobId}/quote/items/{seq}`).
5. Finalize and send the quote (`POST /jobs/{jobId}/quote/finalize`, `POST /jobs/{jobId}/quote/send`).
6. Upload a photo with presigned URL (`POST /jobs/{jobId}/photos/upload-url`, then `PUT` to S3).
7. Scan a receipt via OCR (`POST /jobs/{jobId}/materials/scan`).
8. Advance the job through all five status stages (`PATCH /jobs/{jobId}/status` × 4).
9. Create an invoice (`POST /jobs/{jobId}/invoice`).
10. Verify the job details endpoint returns all child entities (`GET /jobs/{jobId}/details`).

Each step validates the response status code, response body schema, and the expected side effects (e.g., a finalized quote produces a valid S3 PDF URL, an invoice contains the correct VAT calculation at 22%).

### 3.4 Error Handling Tests

| Scenario | Endpoint | Expected Response | SRS Requirement |
|----------|----------|-------------------|-----------------|
| Missing JWT | Any protected | `401 UNAUTHORIZED` | `NFR-SEC-002` |
| Expired JWT | Any protected | `401 TOKEN_EXPIRED` | `FR-AUTH-005` |
| Access another user's job | `GET /jobs/{id}` | `404 NOT_FOUND` | `NFR-SEC-004` |
| Invalid job status transition | `PATCH /jobs/{id}/status` | `400 INVALID_TRANSITION` | `FR-JOB-003` |
| Quote for non-existent job | `POST /jobs/{id}/quote/generate` | `404 NOT_FOUND` | `FR-QUOTE-001` |
| Empty description for quote | `POST /jobs/{id}/quote/generate` | `400 VALIDATION_ERROR` | `FR-QUOTE-001` |
| Upload exceeding 10 MB | `POST /photos/upload-url` | `400 FILE_TOO_LARGE` | `NFR-PERF-004` |
| Invalid FatturaPA fields | `POST /jobs/{id}/invoice` | `400 VALIDATION_ERROR` | `FR-INV-001` |

### 3.5 CI Pipeline Integration

Newman is integrated into the GitHub Actions workflow as a job that runs after unit tests. The pipeline deploys the latest code to the staging environment using AWS CDK (`cdk deploy --context env=staging`), waits for stack stabilisation, then executes the full Postman collection. If any request assertion fails, the pipeline marks the build as failed and publishes the Newman HTML report as an artifact. The staging environment uses a separate DynamoDB table, Cognito User Pool, and S3 bucket to avoid contaminating production data.

---

## 4. User Validation Protocol

User validation tests CantiereSnap with real tradespeople (*artigiani*) to measure whether the system solves the problems it was designed for. This phase provides qualitative and quantitative data for the thesis's Chapter 5 (Testing and Quality Assurance) and directly addresses RQ2 regarding LLM-automated document generation accuracy.

### 4.1 Participant Recruitment

The target is 5–10 participants recruited from the Carmagnola (TO) area and surrounding *comuni*. Eligible participants operate micro-enterprises (fewer than 10 employees) in construction-related trades: plumbing, electrical, tiling, painting, general renovation. Recruitment channels include direct outreach to local tradespeople known to the author, referrals from participants, and posts in local trade WhatsApp groups. Participants receive no monetary compensation but are offered early access to the finished application.

### 4.2 Session Structure

Each validation session lasts approximately 45–60 minutes and is conducted in person at the participant's workshop or on-site, using their own smartphone. Sessions follow a consistent protocol:

| Phase | Duration | Activity | Data Collected |
|-------|----------|----------|----------------|
| 1. Intro | 5 min | Explain CantiereSnap's purpose, obtain verbal consent for observation notes, clarify that the test is about the system, not the participant | Consent confirmation |
| 2. Onboarding | 5 min | Participant registers, verifies email, and logs in on their device | Time to complete, errors encountered |
| 3. Task Set | 25–35 min | Participant completes 5 scripted tasks (see Section 4.3) while the observer takes notes | Task completion (yes/no/partial), time per task, errors, workarounds |
| 4. Quote Review | 5–10 min | Participant reviews AI-generated quote against a reference quote they prepared manually for the same job | Accuracy score (items matched, prices within 15%), subjective quality rating (1–5) |
| 5. Debrief | 5 min | Open-ended feedback on usability, missing features, and overall impression | Qualitative notes, feature requests |

### 4.3 Task Set

Each participant completes five tasks that exercise the core modules. Tasks are presented as realistic scenarios in Italian, written as instructions a client might give verbally:

| # | Task Description | Modules Tested | Success Criteria |
|---|------------------|----------------|------------------|
| T1 | Create a new job for a bathroom renovation at a client's address. Add the client's details (name, codice fiscale, address). | `JOB`, `CLIENT` | Job appears in pipeline with correct status |
| T2 | Describe the job in your own words and generate an AI-powered quote. Review the generated items, edit one price, add one missing item, and finalise. | `QUOTE` | PDF generated with correct totals |
| T3 | Upload two photos of the job site: one "Before" and one "After." Verify the AI-generated descriptions. | `PHOTO` | Photos uploaded, tagged, descriptions visible |
| T4 | Take a photo of a receipt for materials and let the system extract the costs. Verify and correct any extraction errors. | `OCR` | At least 80% of items extracted correctly |
| T5 | Generate an electronic invoice (*FatturaPA*) for the completed job. Verify the XML contains the correct client and line item data. | `INV` | XML preview shows correct fiscal data and totals |

### 4.4 Quote Accuracy Benchmark

Each participant is asked to bring a real quote they prepared manually for a recent job. During the session, the participant describes the same job in natural language into CantiereSnap. The AI-generated quote is compared against the manual reference across three dimensions: item match rate (percentage of reference line items present in the AI output), price accuracy (percentage of items where the AI-suggested unit price falls within ±15% of the reference), and structural completeness (whether the AI output includes labour, materials, and any additional charges present in the reference). Results are tabulated per participant and aggregated for the thesis.

### 4.5 Success Criteria

The user validation phase is considered successful if all three conditions are met: at least 80% of tasks are completed successfully across all participants (T1–T5), the average quote accuracy score (item match rate) reaches 70% or higher, and no participant encounters a blocking error that prevents them from completing the core workflow (create job → generate quote → create invoice).

### 4.6 Data Handling and Ethics

No personally identifiable client data is entered during validation sessions. Participants use fictitious client names and fiscal codes. Observation notes are anonymised (Participant P1, P2, etc.) and stored in the author's private Google Drive. Session data is used exclusively for the thesis and deleted within 30 days of submission.

---

## 5. Performance Benchmark: Lambda vs Fargate

The performance benchmark addresses the capstone's third research question (RQ3): what are the architectural trade-offs of a fully serverless Lambda stack versus a container-based Fargate alternative? The benchmark compares the two compute models across latency, cost, and developer experience, producing quantitative data for the thesis's Chapter 4.

### 5.1 Benchmark Design

A representative subset of CantiereSnap's workload is deployed on both Lambda and Fargate. The subset includes three handlers that span the spectrum of execution profiles: a CRUD operation (`GET /jobs`, low latency, simple I/O), a compute-intensive operation (`POST /jobs/{jobId}/quote/generate`, Claude API call + PDF rendering), and a batch operation (monthly analytics aggregation, triggered by EventBridge). The same application code runs on both platforms, differing only in the deployment wrapper (Lambda handler entry point vs Express.js server on Fargate).

### 5.2 Metrics

| Metric | Measurement Method | NFR Reference |
|--------|--------------------|---------------|
| Cold-start latency | Invoke each handler after a 15-minute idle period. Measure time from API Gateway request receipt to first byte of response. Repeat 20 times per handler and report p50, p95, p99. | `NFR-PERF-002` |
| Warm latency | Send 100 sequential requests with no idle gap. Measure the same time span. Report p50, p95, p99. | `NFR-PERF-001` |
| Cost per 1,000 requests | Calculate based on AWS pricing: Lambda (request count + GB-seconds), Fargate (vCPU-hours + GB-hours). Use the same memory allocation (512 MB) for both. | `NFR-COST-001` |
| Throughput | Send 50 concurrent requests using a load test tool (Artillery). Measure successful responses per second and error rate. | `NFR-SCALE-001` |
| Developer experience | Subjective rating (1–5) across deployment speed, debugging ease, local testing workflow, and log access. Documented as a narrative comparison. | — |

### 5.3 Environment Configuration

Both environments are deployed in `eu-south-1` (Milan) to match CantiereSnap's production region and minimise network variance. Lambda functions use 512 MB memory with the default Node.js 20.x runtime. The Fargate service runs a single task with 0.5 vCPU and 1 GB memory behind an Application Load Balancer, using the same Node.js 20.x base image. Both environments connect to the same staging DynamoDB table and S3 bucket to ensure identical data access patterns.

### 5.4 Execution Protocol

The benchmark runs over a single day. Morning: deploy both environments, verify functionality with a smoke test (one request per endpoint), then run cold-start tests. Afternoon: run warm latency tests, followed by throughput tests. Evening: collect CloudWatch metrics, calculate costs, and document developer experience observations. All raw data (request timestamps, response times, CloudWatch logs) is exported to a CSV file stored in the GitHub repository under `/tests/benchmark/` for reproducibility.

### 5.5 Expected Outcome

Based on the architecture's design rationale, Lambda is expected to outperform Fargate on cost at CantiereSnap's low-traffic scale (fewer than 50 users), while Fargate is expected to offer lower and more predictable latency due to the absence of cold starts. The benchmark will quantify this trade-off rather than declare a winner, presenting the data in a format that allows the reader to evaluate the choice for their own workload profile.

---

## 6. Acceptance Criteria Matrix

The following matrix maps each CantiereSnap module to its acceptance test, the testing level at which it is verified, and the pass/fail threshold. The system is accepted when all Must-priority requirements pass their tests and at least 80% of Should-priority requirements pass.

| Module | Acceptance Test | Validation Method | Testing Level |
|--------|----------------|-------------------|---------------|
| `AUTH` | Tradesperson registers, verifies email, logs in, and accesses a protected endpoint | Automated integration test | Integration |
| `JOB` | Job is created and advanced through all 5 status stages with correct timestamps | Automated integration test + user validation | Integration, Validation |
| `QUOTE` | Natural-language description produces an itemised PDF quote with correct totals within 15 seconds | Accuracy benchmark against 10 manual quotes | Unit, Integration, Validation |
| `PHOTO` | Photo uploads to S3 with metadata in DynamoDB, AI description is generated and editable | Manual test + user validation | Integration, Validation |
| `OCR` | Receipt photo is processed by Textract, extracted items match receipt content with >80% accuracy | Automated test with sample receipts | Unit, Integration, Validation |
| `INV` | Generated *FatturaPA* XML passes SDI schema validation | XML schema validation tool | Unit, Integration |
| `DASH` | Dashboard displays accurate revenue, completion rate, and overdue invoices for seeded test data | Automated test with seeded data | Unit, Integration |
| `NOTIFY` | Overdue invoice triggers email reminder via EventBridge + SES | Automated integration test | Integration |

---

## 7. Tools and Infrastructure Summary

| Tool | Purpose | Phase | Configuration |
|------|---------|-------|---------------|
| Jest | Unit test runner + coverage | Unit Testing | `jest.config.ts`, coverage threshold 80% |
| Postman | API test design and execution | Integration Testing | Collection in `/tests/postman/` |
| Newman | CI execution of Postman tests | Integration Testing | GitHub Actions job |
| Artillery | Load testing (throughput) | Performance Benchmark | YAML config, 50 concurrent users |
| AWS CDK | Infrastructure deployment (staging) | All phases | `cdk.json`, staging context |
| GitHub Actions | CI/CD pipeline | All phases | `.github/workflows/test.yml` |
| CloudWatch | Metrics collection (latency, errors) | Performance Benchmark | Custom dashboard |
| Google Sheets | User validation data collection | User Validation | Anonymised participant data |

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Fewer than 5 participants recruited | Medium | High | Begin recruitment in mid-June (4 weeks before sessions). Use personal network and referrals. Accept remote sessions via screen-sharing as a fallback for hard-to-reach participants. |
| Claude API rate limits during load test | Low | Medium | Run AI-intensive benchmarks during off-peak hours (early morning CET). Use cached responses for throughput tests where quote content quality is not being measured. |
| Staging environment drift from production config | Medium | Medium | Deploy staging via the same CDK stack with a context parameter (`env=staging`). Automate teardown and re-deployment before each test run. |
| Flaky integration tests due to eventual consistency | Medium | Low | Insert brief polling waits (exponential backoff, max 5 seconds) after write operations before asserting read results. Flag intermittent failures for manual review. |
| *FatturaPA* schema change by Agenzia delle Entrate | Low | High | Pin the XML schema version (1.2) and validate against the pinned schema. Monitor the Agenzia delle Entrate website for change notices. |
