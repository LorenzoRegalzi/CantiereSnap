#!/usr/bin/env bash
# Run CantiereSnap integration tests against the staging API.
#
# Usage:
#   ./run-tests.sh
#   ./run-tests.sh --reporter htmlextra
#   TEST_PASSWORD=MySecret ./run-tests.sh
#
# Prerequisites:
#   npm install -g newman newman-reporter-htmlextra
#
# The script injects TEST_PASSWORD from the environment so the secret never
# needs to be stored in the environment file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECTION="$SCRIPT_DIR/CantiereSnap_Integration.postman_collection.json"
ENVIRONMENT="$SCRIPT_DIR/staging.postman_environment.json"
RESULTS_JSON="$SCRIPT_DIR/results.json"
RESULTS_HTML="$SCRIPT_DIR/results.html"

if ! command -v newman &> /dev/null; then
  echo "ERROR: newman not found. Install it with: npm install -g newman newman-reporter-htmlextra"
  exit 1
fi

if [[ -z "${TEST_PASSWORD:-}" ]]; then
  echo "WARNING: TEST_PASSWORD is not set. Authentication tests will fail."
  echo "  Set it with: TEST_PASSWORD=<password> ./run-tests.sh"
fi

REPORTERS="cli,json"
EXTRA_ARGS=()

# Support optional --reporter htmlextra for local HTML report generation
for arg in "$@"; do
  if [[ "$arg" == "--reporter" ]]; then
    :
  elif [[ "$arg" == "htmlextra" ]]; then
    REPORTERS="cli,json,htmlextra"
    EXTRA_ARGS+=(--reporter-htmlextra-export "$RESULTS_HTML")
    echo "HTML report will be written to: $RESULTS_HTML"
  else
    EXTRA_ARGS+=("$arg")
  fi
done

echo "Running CantiereSnap integration tests against staging..."
echo "Collection : $COLLECTION"
echo "Environment: $ENVIRONMENT"
echo ""

newman run "$COLLECTION" \
  --environment "$ENVIRONMENT" \
  --env-var "testPassword=${TEST_PASSWORD:-}" \
  --timeout-request 60000 \
  --delay-request 500 \
  --reporters "$REPORTERS" \
  --reporter-json-export "$RESULTS_JSON" \
  "${EXTRA_ARGS[@]}"

EXIT_CODE=$?

echo ""
echo "JSON results saved to: $RESULTS_JSON"

exit $EXIT_CODE
