#!/usr/bin/env ts-node
/**
 * CantiereSnap Cost Calculator — Lambda vs Fargate (eu-south-1)
 *
 * Usage:
 *   npx ts-node cost-calculator.ts
 *   npx ts-node cost-calculator.ts --requests-per-day 500 --avg-duration-ms 120
 */

// ── Pricing (eu-south-1, June 2026) ──────────────────────────────────────────

const LAMBDA = {
  requestCostPerMillion: 0.20,          // USD per 1M invocations
  gbSecondCost: 0.0000166667,           // USD per GB-second
  memorySizeGb: 0.5,                    // 512 MB
  freeTierRequests: 1_000_000,          // per month
  freeTierGbSeconds: 400_000,           // per month
};

const FARGATE = {
  vcpuHourCost: 0.04048,               // USD per vCPU-hour
  gbHourCost: 0.004445,                // USD per GB-hour
  vcpu: 0.5,
  memoryGb: 1.0,
  hoursPerMonth: 730,                   // always-on
};

// ── Benchmark-measured average durations (ms) — fill after running benchmark ─
const BENCHMARK = {
  lambdaGetJobs:   0,    // fill from Artillery p50
  lambdaPostJobs:  0,
  fargateGetJobs:  0,
  fargatePostJobs: 0,
};

// ── Calculation helpers ────────────────────────────────────────────────────────

function calcLambdaCost(
  requestsPerMonth: number,
  avgDurationMs: number,
  applyFreeTier = true,
): { requestCost: number; computeCost: number; total: number } {
  const billableRequests = applyFreeTier
    ? Math.max(0, requestsPerMonth - LAMBDA.freeTierRequests)
    : requestsPerMonth;

  const gbSeconds = (avgDurationMs / 1000) * LAMBDA.memorySizeGb * requestsPerMonth;
  const billableGbSeconds = applyFreeTier
    ? Math.max(0, gbSeconds - LAMBDA.freeTierGbSeconds)
    : gbSeconds;

  const requestCost  = (billableRequests / 1_000_000) * LAMBDA.requestCostPerMillion;
  const computeCost  = billableGbSeconds * LAMBDA.gbSecondCost;
  return { requestCost, computeCost, total: requestCost + computeCost };
}

function calcFargateCost(): { vcpuCost: number; memoryCost: number; total: number } {
  const vcpuCost   = FARGATE.vcpuHourCost * FARGATE.vcpu * FARGATE.hoursPerMonth;
  const memoryCost = FARGATE.gbHourCost   * FARGATE.memoryGb * FARGATE.hoursPerMonth;
  return { vcpuCost, memoryCost, total: vcpuCost + memoryCost };
}

function fmt(n: number): string {
  return `$${n.toFixed(4)}`;
}

// ── Main output ────────────────────────────────────────────────────────────────

const workloads = [
  { label: '100 req/day  (1 user)',   daily: 100  },
  { label: '1,000 req/day (5 users)', daily: 1_000 },
  { label: '10,000 req/day (50 users)', daily: 10_000 },
  { label: '100,000 req/day (enterprise)', daily: 100_000 },
];

const avgDurationMs = 120; // conservative average across all endpoints

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CantiereSnap — Lambda vs Fargate Monthly Cost Estimate');
console.log('  Region: eu-south-1 (Milan)  |  Lambda: 512MB  |  Fargate: 0.5vCPU/1GB');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`${'Workload'.padEnd(35)} ${'Lambda (free tier)'.padEnd(22)} ${'Lambda (no free)'.padEnd(22)} ${'Fargate (always-on)'.padEnd(22)}`);
console.log('─'.repeat(103));

for (const w of workloads) {
  const monthly = w.daily * 30;
  const lambdaFree   = calcLambdaCost(monthly, avgDurationMs, true);
  const lambdaNoFree = calcLambdaCost(monthly, avgDurationMs, false);
  const fargate      = calcFargateCost();

  console.log(
    `${w.label.padEnd(35)} ${fmt(lambdaFree.total).padEnd(22)} ${fmt(lambdaNoFree.total).padEnd(22)} ${fmt(fargate.total).padEnd(22)}`
  );
}

const fargate = calcFargateCost();
console.log('─'.repeat(103));
console.log(`\nFargate always-on breakdown:`);
console.log(`  vCPU (0.5 × 730h): ${fmt(fargate.vcpuCost)}`);
console.log(`  Memory (1GB × 730h): ${fmt(fargate.memoryCost)}`);
console.log(`  Total/month: ${fmt(fargate.total)}`);

console.log(`\nNotes:`);
console.log(`  - Lambda free tier applies once per AWS account per month`);
console.log(`  - Fargate cost is fixed regardless of actual request volume`);
console.log(`  - Lambda becomes more expensive than Fargate at ~${
  Math.round(fargate.total / (LAMBDA.requestCostPerMillion / 1_000_000))
    .toLocaleString()
} requests/month (no free tier)`);
console.log(`  - Lambda wins for spiky workloads; Fargate wins for constant ~500+ req/min`);
console.log(`  - AI quote generation adds ~$0.03 per call (Claude Sonnet 4.6) regardless of platform`);

// Break-even point (no free tier)
const fargateTotal = fargate.total;
// Lambda: ~$0.20/1M requests + $0.0000166667 × 0.5 × avgDurS × requests
// = requests × (0.20/1M + 0.0000166667 × 0.5 × avgDurS)
const avgDurS = avgDurationMs / 1000;
const lambdaPerRequest = (0.20 / 1_000_000) + (LAMBDA.gbSecondCost * LAMBDA.memorySizeGb * avgDurS);
const breakEvenRequests = Math.round(fargateTotal / lambdaPerRequest);
console.log(`\nBreak-even (no free tier, avg ${avgDurationMs}ms): ${breakEvenRequests.toLocaleString()} requests/month = ${Math.round(breakEvenRequests / 30).toLocaleString()} req/day`);
console.log('');
