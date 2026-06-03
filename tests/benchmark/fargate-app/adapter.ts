import type { Request } from 'express';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { randomUUID } from 'crypto';

// Decode JWT payload without verification (Cognito already validated the token).
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Convert an Express request + the matched API Gateway resource pattern to a
// minimal APIGatewayProxyEvent that the Lambda handlers can consume.
export function expressToApiGatewayEvent(
  req: Request,
  resource: string,
): APIGatewayProxyEvent {
  const authHeader = (req.headers.authorization ?? '') as string;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const claims = decodeJwtPayload(token);

  const queryStringParameters: Record<string, string> | null =
    Object.keys(req.query).length > 0
      ? Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]))
      : null;

  const pathParameters: Record<string, string> | null =
    Object.keys(req.params).length > 0
      ? (req.params as Record<string, string>)
      : null;

  return {
    httpMethod: req.method.toUpperCase(),
    path: req.path,
    resource,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    headers: req.headers as Record<string, string>,
    multiValueHeaders: {},
    body: req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      authorizer: { claims },
      httpMethod: req.method.toUpperCase(),
      path: req.path,
      stage: 'fargate',
      requestId: randomUUID(),
      resourcePath: resource,
      identity: {} as never,
      accountId: '',
      apiId: '',
      protocol: 'HTTP/1.1',
      requestTime: new Date().toUTCString(),
      requestTimeEpoch: Date.now(),
      resourceId: '',
    },
  } as APIGatewayProxyEvent;
}

// Minimal Lambda context — handlers only use awsRequestId.
export function makeLambdaContext(): Context {
  return {
    awsRequestId: randomUUID(),
    functionName: 'fargate-benchmark',
    functionVersion: '$LATEST',
    invokedFunctionArn: '',
    memoryLimitInMB: '1024',
    logGroupName: '/fargate/benchmark',
    logStreamName: 'fargate',
    callbackWaitsForEmptyEventLoop: false,
    getRemainingTimeInMillis: () => 300_000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}
