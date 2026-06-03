# CantiereSnap — Performance Benchmark Results

## Test Date: 2026-06-03
## Tester: Lorenzo Regalzi
## Environment: eu-south-1 (Milan)

---

## Configuration

| Parameter | Lambda | Fargate |
|---|---|---|
| Memory | 512 MB | 1 GB |
| vCPU | auto (burst) | 0.5 vCPU |
| Region | eu-south-1 | eu-south-1 |
| Runtime | Node.js 20.x | Node.js 20.x |
| DynamoDB | Shared staging table | Shared staging table |
| S3 | Shared staging bucket | Shared staging bucket |
| Cold start definition | 15 min idle | 15 min idle |
| Load tool | Artillery 2.0.32 | Artillery 2.0.32 |

---

## 1. Cold Start Latency

Cold start measurement was not run as a dedicated test (would require 15 min idle + 20 requests × 30 s apart = ~25 min). However, Lambda cold starts were directly observed in the first warm-up window of the CRUD benchmark: the first request batch (42 requests) shows **p99 = 2,322 ms**, dropping to p99 ≈ 330 ms once warm. Fargate has no cold start — the container is always running.

| Endpoint | Lambda p50 | Lambda p95 | Lambda p99 | Fargate p50 | Fargate p95 | Fargate p99 |
|---|---|---|---|---|---|---|
| GET /jobs (warm-up window) | ~340 ms | ~2,231 ms | 2,322 ms | ~36 ms | ~97 ms | 97 ms |
| GET /jobs (after warm) | ~175 ms | ~354 ms | ~620 ms | ~28 ms | ~74 ms | ~136 ms |

**Observation:** Lambda cold starts on the Jobs handler hit ~2.3 s p99, a 13× spike vs warm latency. Fargate shows no equivalent behaviour — the ALB routes to a continuously running container with consistent latency from the first request.

---

## 2. Warm Latency — Sustained Load (10 rps, 120 seconds)

Artillery scenario: 10 concurrent arrivals/second for 2 minutes.

| Endpoint | Lambda p50 | Lambda p95 | Lambda p99 | Fargate p50 | Fargate p95 | Fargate p99 |
|---|---|---|---|---|---|---|
| GET /jobs | 176 ms | 354 ms | 620 ms | 28 ms | 74 ms | 136 ms |
| POST /jobs | 118 ms | 238 ms | 518 ms | 34 ms | 87 ms | 194 ms |

**Observation:** Fargate is **5–6× faster** at median across both endpoints under sustained load. The Lambda overhead comes from API Gateway request processing, Lambda invocation bootstrap, and DynamoDB SDK initialisation on each container instance. Fargate keeps the Express process and SDK clients warm between requests, eliminating that per-request overhead.

---

## 3. Spike Throughput (50 rps, 30 seconds)

| Metric | Lambda | Fargate |
|---|---|---|
| Total requests sent | 1,451 | 1,575 |
| Successful (2xx) | 1,324 | 1,575 |
| Error rate | 8.8% | 0.0% |
| p99 latency | 889 ms | 257 ms |
| Throttle / 429 errors | 0 (500s from DDB throttle) | 0 |

**Observation:** Lambda produced 127 HTTP 500 errors at 50 rps — likely DynamoDB on-demand throttling under burst write pressure on the shared staging table. Fargate handled the same spike with zero errors and p99 = 257 ms. Both platforms share the same DynamoDB table, so Lambda errors may partly reflect table-level throttling. In a dedicated production setup with provisioned capacity, Lambda errors would decrease. Fargate's 5× lower latency gives it more headroom before DynamoDB becomes the bottleneck.

---

## 4. AI Quote Generation

Separate low-rate test (1 scenario/15 s, maxVusers=1). Each Lambda scenario: POST /jobs → POST /jobs/{id}/quote/generate (202) → poll GET every 5 s until status=Draft. Each Fargate scenario: POST /jobs → POST /jobs/{id}/quote/generate (201, synchronous).

| Metric | Lambda (async 202+poll) | Fargate (sync 201) |
|---|---|---|
| Completions (in 450 s window) | 8 | 18 |
| p50 time-to-data (session length) | 61.7 s | 24.6 s |
| p95 time-to-data | 63.0 s | 27.7 s |
| Success rate | 100% | 100% |
| 504 / timeout errors | 0 (async avoids GW timeout) | n/a |

**Note:** Lambda `time-to-data` includes polling delay (5 s steps) on top of the actual Claude API call (~25 s). Fargate measures the direct synchronous HTTP response time. Lambda's observed wait (~62 s) is longer than Fargate's (~25 s) because polling adds discrete 5-second increments and the async Lambda handler experiences cold starts before the Claude call begins. The API Gateway 29 s timeout is the **hard architectural constraint**: synchronous AI generation on Lambda would 504 for any Claude response >29 s.

**Observation:** Fargate's synchronous model delivers AI results **2.5× faster** to the end user and is architecturally simpler (no async + polling infrastructure). This is the primary technical justification for Fargate in AI-heavy workloads.

---

## 5. Cost Estimate (monthly, no AWS free tier after first month)

Pricing: Lambda $0.20/1M requests + $0.0000166667/GB-s (512 MB); Fargate $0.04048/vCPU-h + $0.004445/GB-h (0.5 vCPU, 1 GB, always-on). Average Lambda duration: 145 ms (measured median).

| Workload | Lambda (no free tier) | Lambda (with free tier) | Fargate |
|---|---|---|---|
| 100 req/day (1 user) | $0.0042 | $0.0000 | $18.02 |
| 1,000 req/day (5 users) | $0.0423 | $0.0000 | $18.02 |
| 10,000 req/day (50 users) | $0.4225 | $0.0000 | $18.02 |
| Break-even point | ~430,000 req/day | never (always cheaper) | $18.02/month |

---

## 6. Developer Experience (subjective 1–5)

| Dimension | Lambda | Fargate | Notes |
|---|---|---|---|
| Deployment speed | 4/5 | 2/5 | Lambda CDK deploy ~2 min; Fargate Docker build + push + ECS rolling ~5 min |
| Debugging ease | 3/5 | 4/5 | Both use CloudWatch; Fargate has one clean log stream per container |
| Local testing | 2/5 | 5/5 | Lambda needs SAM/localstack; Fargate runs with `ts-node server.ts` |
| Log access | 3/5 | 4/5 | Lambda logs scattered across per-handler log groups; Fargate is one stream |
| Cold start predictability | 2/5 | 5/5 | Lambda p99 cold start = 2.3 s; Fargate has none |
| Overall | 3/5 | 4/5 | Fargate wins on DX; Lambda wins on ops simplicity at zero traffic |

---

## 7. Summary & Thesis Findings (RQ3)

**Winner by category:**
- Latency (warm): **Fargate** (5–6× lower median; 32 ms vs 153 ms overall)
- Cold start: **Fargate** (none; Lambda spikes to 2.3 s p99)
- Throughput under spike: **Fargate** (0% errors vs 8.8% at 50 rps)
- Cost (micro-enterprise, <10,000 req/day): **Lambda** (~$0.42/month vs $18.02/month)
- Cost (growth, >430,000 req/day): **Fargate** (Lambda cost approaches $18/month)
- AI workloads (>29 s response): **Fargate** (no timeout constraint; 2.5× faster time-to-data)
- Operational complexity: **Lambda** (no Docker, no VPC, no container management)

**Recommendation for CantiereSnap:**

Lambda is the correct choice for CantiereSnap at its target scale (5–50 users, <10,000 req/day). The cost advantage is overwhelming ($0.42/month vs $18.02/month at 10,000 req/day), and the operational simplicity aligns with the zero-budget NFR-COST-001 constraint. The AI quote generation workaround (async 202 + client polling) is an acceptable trade-off: it avoids the 29 s API Gateway limit and the added latency (~62 s total vs ~25 s) is tolerable for an infrequent, user-initiated action where the UI shows a loading state.

**Key finding for RQ3:**
> Lambda's serverless model delivers near-zero operational cost at micro-enterprise scale
> (<10,000 req/day), where Fargate's always-on cost of $18.02/month is unjustified.
> The primary architectural advantage of Fargate is the absence of API Gateway's 29-second
> limit, which required an async workaround for AI quote generation on Lambda. Under
> sustained load, Fargate is 5–6× faster (median 32 ms vs 153 ms) and handles spike
> traffic with zero errors vs 8.8% on Lambda at 50 rps. The cost break-even threshold is
> ~430,000 req/day — far beyond CantiereSnap's target user base. Fargate becomes the
> technically superior choice only when synchronous AI response time is critical or
> request volume exceeds several hundred thousand requests per day.

---

## Appendix: Raw Artillery Output Files

- `lambda_20260603_070426.json` — Lambda CRUD benchmark (2,850 req, warm-up + 10 rps sustained + 50 rps spike)
- `fargate_20260603_070426.json` — Fargate CRUD benchmark (2,850 req, same scenario)
- `ai-lambda_20260603_073918.json` — Lambda AI benchmark (8 completions, 450 s window, async+poll)
- `ai-fargate_20260603_082041.json` — Fargate AI benchmark (18 completions, 450 s window, synchronous)
