#!/usr/bin/env bash
# CantiereSnap Performance Benchmark Runner
# Usage: ./run-benchmark.sh <lambda|fargate|both|ai-lambda|ai-fargate|coldstart>
#
# Prerequisites:
#   npm install -g artillery artillery-plugin-metrics-by-endpoint
#   Set env vars: TEST_EMAIL, TEST_PASSWORD, CLIENT_ID
#   For fargate: set FARGATE_URL to the ALB URL from CDK output
#
# Example:
#   TEST_EMAIL=regalzi.lorenzo@gmail.com TEST_PASSWORD=MyPass CLIENT_ID=abc123 ./run-benchmark.sh both

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

LAMBDA_URL="${LAMBDA_URL:-https://ec0ws3spi8.execute-api.eu-south-1.amazonaws.com/staging}"
FARGATE_URL="${FARGATE_URL:-http://REPLACE_WITH_ALB_URL}"

# ── Obtain JWT token ────────────────────────────────────────────────────────────

get_token() {
  local base_url="$1"
  local response
  response=$(curl -s -X POST "$base_url/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${TEST_EMAIL:?'TEST_EMAIL not set'}\",\"password\":\"${TEST_PASSWORD:?'TEST_PASSWORD not set'}\"}")

  local token
  token=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken',''))" 2>/dev/null || true)

  if [[ -z "$token" ]]; then
    echo "ERROR: failed to obtain access token. Response: $response" >&2
    exit 1
  fi
  echo "$token"
}

# ── Generic benchmark runner ────────────────────────────────────────────────────

run_benchmark() {
  local platform="$1"
  local config_file="$2"
  local access_token="$3"
  local output_json="$RESULTS_DIR/${platform}_${TIMESTAMP}.json"
  local output_html="$RESULTS_DIR/${platform}_${TIMESTAMP}.html"

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  $platform benchmark  |  $(date)"
  echo "════════════════════════════════════════════════════════"

  artillery run \
    --variables "{\"accessToken\":\"$access_token\",\"clientId\":\"${CLIENT_ID:?'CLIENT_ID not set'}\"}" \
    --output "$output_json" \
    "$config_file"

  artillery report "$output_json" --output "$output_html"
  echo ""
  echo "  JSON results : $output_json"
  echo "  HTML report  : $output_html"
}

# ── Cold-start measurement ──────────────────────────────────────────────────────

run_coldstart() {
  local platform="$1"
  local base_url="$2"
  local access_token="$3"
  local output="$RESULTS_DIR/${platform}_coldstart_${TIMESTAMP}.csv"

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  $platform COLD START  |  waiting 15 min for idle state"
  echo "════════════════════════════════════════════════════════"
  sleep 900

  echo "platform,endpoint,attempt,response_time_ms" > "$output"

  for i in $(seq 1 20); do
    local t
    t=$(curl -s -o /dev/null -w "%{time_total}" \
      -H "Authorization: Bearer $access_token" \
      "$base_url/jobs" 2>/dev/null)
    local ms
    ms=$(python3 -c "print(round(float('$t') * 1000))")
    echo "$platform,GET /jobs,$i,$ms" >> "$output"
    echo "  attempt $i: ${ms}ms"
    sleep 30
  done

  echo "  Cold start CSV: $output"
}

# ── Main ────────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <lambda|fargate|both|ai-lambda|ai-fargate|coldstart>"
  echo ""
  echo "  lambda      — CRUD benchmark against Lambda/API Gateway"
  echo "  fargate     — CRUD benchmark against Fargate/ALB"
  echo "  both        — Run lambda then fargate with 60s gap"
  echo "  ai-lambda   — AI quote benchmark against Lambda (async, 202+poll)"
  echo "  ai-fargate  — AI quote benchmark against Fargate (sync, 201)"
  echo "  coldstart   — Cold-start latency measurement (15-min idle + 20 requests)"
  exit 1
fi

echo "Obtaining JWT token from Lambda staging..."
ACCESS_TOKEN=$(get_token "$LAMBDA_URL")
echo "Token obtained."

case "${1}" in
  lambda)
    run_benchmark "lambda" "$SCRIPT_DIR/artillery/lambda-benchmark.yml" "$ACCESS_TOKEN"
    ;;

  fargate)
    # Update target URL in fargate config for this run
    sed "s|http://REPLACE_WITH_ALB_URL|${FARGATE_URL}|g" \
      "$SCRIPT_DIR/artillery/fargate-benchmark.yml" > /tmp/fargate-benchmark-run.yml
    run_benchmark "fargate" "/tmp/fargate-benchmark-run.yml" "$ACCESS_TOKEN"
    ;;

  both)
    run_benchmark "lambda" "$SCRIPT_DIR/artillery/lambda-benchmark.yml" "$ACCESS_TOKEN"
    echo ""
    echo "Waiting 60s between benchmarks to let staging settle..."
    sleep 60
    sed "s|http://REPLACE_WITH_ALB_URL|${FARGATE_URL}|g" \
      "$SCRIPT_DIR/artillery/fargate-benchmark.yml" > /tmp/fargate-benchmark-run.yml
    run_benchmark "fargate" "/tmp/fargate-benchmark-run.yml" "$ACCESS_TOKEN"
    ;;

  ai-lambda)
    echo ""
    echo "NOTE: AI benchmark — 30 requests at 1 rps, estimated cost \$0.90, ~8 minutes"
    run_benchmark "ai-lambda" "$SCRIPT_DIR/artillery/ai-benchmark.yml" "$ACCESS_TOKEN"
    ;;

  ai-fargate)
    echo ""
    echo "NOTE: AI benchmark — 30 requests, synchronous ~25s per response, ~13 minutes"
    sed "s|https://ec0ws3spi8.execute-api.eu-south-1.amazonaws.com/staging|${FARGATE_URL}|g" \
      "$SCRIPT_DIR/artillery/ai-benchmark.yml" > /tmp/ai-fargate-run.yml
    # Remove the polling loop — Fargate returns 201 synchronously
    python3 - <<'PYEOF' "$SCRIPT_DIR/artillery/ai-benchmark.yml" /tmp/ai-fargate-sync.yml
import sys, re

with open(sys.argv[1]) as f:
    content = f.read()

# Remove the polling loop (keep only the POST request)
content = re.sub(r'\s+# Lambda returns 202.*?count: 12.*?\'Draft\'[^\n]*\n', '\n', content, flags=re.DOTALL)
content = content.replace(
    'https://ec0ws3spi8.execute-api.eu-south-1.amazonaws.com/staging',
    sys.argv[2] if len(sys.argv) > 2 else 'FARGATE_URL'
)

with open(sys.argv[2], 'w') as f:
    f.write(content)
PYEOF
    run_benchmark "ai-fargate" "/tmp/ai-fargate-sync.yml" "$ACCESS_TOKEN"
    ;;

  coldstart)
    run_coldstart "lambda" "$LAMBDA_URL" "$ACCESS_TOKEN"
    if [[ "$FARGATE_URL" != *"REPLACE"* ]]; then
      run_coldstart "fargate" "$FARGATE_URL" "$ACCESS_TOKEN"
    else
      echo "FARGATE_URL not set — skipping Fargate cold start"
    fi
    ;;

  *)
    echo "Unknown command: $1"
    exit 1
    ;;
esac

echo ""
echo "All results saved to $RESULTS_DIR/"
