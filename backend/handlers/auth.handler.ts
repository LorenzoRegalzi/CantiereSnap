import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger } from '../shared/logger';
import {
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { cognitoClient } from '../shared/cognito';
import { docClient } from '../shared/dynamodb';
import {
  ok,
  created,
  badRequest,
  notFound,
  conflict,
  unauthorized,
  forbidden,
  internalError,
} from '../shared/response';

const TABLE = process.env.TABLE_NAME!;
const CLIENT_ID = process.env.CLIENT_ID!;

// ── Validation ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTITA_IVA_RE = /^IT\d{11}$/;
const CODICE_FISCALE_RE = /^[A-Z0-9]{16}$/i;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

const VALID_REGIME_CODES = new Set([
  'RF01', 'RF02', 'RF04', 'RF05', 'RF06', 'RF07', 'RF08', 'RF09', 'RF10',
  'RF11', 'RF12', 'RF13', 'RF14', 'RF15', 'RF16', 'RF17', 'RF18', 'RF19',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBody<T>(event: APIGatewayProxyEvent): T {
  try {
    return JSON.parse(event.body ?? '{}') as T;
  } catch {
    return {} as T;
  }
}

function cognitoErrorName(err: unknown): string {
  return (err as { name?: string }).name ?? '';
}

function getUserId(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.claims?.sub as string;
}

function toProfileResponse(item: Record<string, unknown>) {
  return {
    userId: item.userId,
    email: item.email,
    fullName: item.fullName ?? null,
    businessName: item.businessName ?? null,
    partitaIva: item.partitaIva ?? null,
    codiceFiscale: item.codiceFiscale ?? null,
    regimeFiscale: item.regimeFiscale ?? null,
    address: item.address ?? null,
    phone: item.phone ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function getProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);

  const result = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }),
  );

  if (!result.Item) return notFound('Profile not found.');
  return ok(toProfileResponse(result.Item as Record<string, unknown>));
}

async function updateProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);

  const body = parseBody<{
    fullName?: string;
    businessName?: string;
    partitaIva?: string;
    codiceFiscale?: string;
    regimeFiscale?: string;
    address?: { street?: string; city?: string; province?: string; cap?: string; country?: string };
    phone?: string;
  }>(event);

  if (body.fullName !== undefined) {
    if (typeof body.fullName !== 'string' || body.fullName.trim().length < 2)
      return badRequest('VALIDATION_ERROR', 'fullName must be at least 2 characters.', 'fullName');
    if (body.fullName.trim().length > 100)
      return badRequest('VALIDATION_ERROR', 'fullName must be at most 100 characters.', 'fullName');
  }

  if (body.businessName !== undefined) {
    if (typeof body.businessName !== 'string' || body.businessName.trim().length < 2)
      return badRequest('VALIDATION_ERROR', 'businessName must be at least 2 characters.', 'businessName');
    if (body.businessName.trim().length > 200)
      return badRequest('VALIDATION_ERROR', 'businessName must be at most 200 characters.', 'businessName');
  }

  if (body.partitaIva !== undefined) {
    if (typeof body.partitaIva !== 'string' || !PARTITA_IVA_RE.test(body.partitaIva))
      return badRequest('VALIDATION_ERROR', 'partitaIva must be in format IT + 11 digits (e.g. IT12345678901).', 'partitaIva');
  }

  if (body.codiceFiscale !== undefined) {
    if (typeof body.codiceFiscale !== 'string' || !CODICE_FISCALE_RE.test(body.codiceFiscale))
      return badRequest('VALIDATION_ERROR', 'codiceFiscale must be 16 alphanumeric characters.', 'codiceFiscale');
  }

  if (body.regimeFiscale !== undefined) {
    if (!VALID_REGIME_CODES.has(body.regimeFiscale))
      return badRequest('VALIDATION_ERROR', 'Invalid regimeFiscale code.', 'regimeFiscale');
  }

  if (body.address !== undefined) {
    const a = body.address;
    if (!a.street || !a.city || !a.province || !a.cap || !a.country)
      return badRequest('VALIDATION_ERROR', 'address must include street, city, province, cap, and country.', 'address');
  }

  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || !PHONE_RE.test(body.phone))
      return badRequest('VALIDATION_ERROR', 'phone must be in international format (e.g. +393331234567).', 'phone');
  }

  const updatableFields = ['fullName', 'businessName', 'partitaIva', 'codiceFiscale', 'regimeFiscale', 'address', 'phone'] as const;
  if (!updatableFields.some(f => body[f] !== undefined))
    return badRequest('VALIDATION_ERROR', 'Request body must include at least one updatable field.');

  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }),
  );
  if (!existing.Item) return notFound('Profile not found.');

  const now = new Date().toISOString();
  const updates: string[] = ['updatedAt = :updatedAt'];
  const exprValues: Record<string, unknown> = { ':updatedAt': now };

  if (body.fullName !== undefined) { updates.push('fullName = :fullName'); exprValues[':fullName'] = body.fullName.trim(); }
  if (body.businessName !== undefined) { updates.push('businessName = :businessName'); exprValues[':businessName'] = body.businessName.trim(); }
  if (body.partitaIva !== undefined) { updates.push('partitaIva = :partitaIva'); exprValues[':partitaIva'] = body.partitaIva; }
  if (body.codiceFiscale !== undefined) { updates.push('codiceFiscale = :codiceFiscale'); exprValues[':codiceFiscale'] = body.codiceFiscale.toUpperCase(); }
  if (body.regimeFiscale !== undefined) { updates.push('regimeFiscale = :regimeFiscale'); exprValues[':regimeFiscale'] = body.regimeFiscale; }
  if (body.address !== undefined) { updates.push('address = :address'); exprValues[':address'] = body.address; }
  if (body.phone !== undefined) { updates.push('phone = :phone'); exprValues[':phone'] = body.phone; }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeValues: exprValues,
    }),
  );

  const current = existing.Item as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current, updatedAt: now };
  if (body.fullName !== undefined) merged.fullName = body.fullName.trim();
  if (body.businessName !== undefined) merged.businessName = body.businessName.trim();
  if (body.partitaIva !== undefined) merged.partitaIva = body.partitaIva;
  if (body.codiceFiscale !== undefined) merged.codiceFiscale = body.codiceFiscale.toUpperCase();
  if (body.regimeFiscale !== undefined) merged.regimeFiscale = body.regimeFiscale;
  if (body.address !== undefined) merged.address = body.address;
  if (body.phone !== undefined) merged.phone = body.phone;

  return ok(toProfileResponse(merged));
}

async function register(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ email?: string; password?: string; fullName?: string }>(event);

  if (!body.email || !EMAIL_RE.test(body.email))
    return badRequest('VALIDATION_ERROR', 'Invalid email address.', 'email');

  if (!body.password || body.password.length < 8)
    return badRequest('VALIDATION_ERROR', 'password must be at least 8 characters.', 'password');

  const fullName = body.fullName?.trim() ?? '';
  if (fullName.length < 2)
    return badRequest('VALIDATION_ERROR', 'fullName is required (minimum 2 characters).', 'fullName');
  if (fullName.length > 100)
    return badRequest('VALIDATION_ERROR', 'fullName must not exceed 100 characters.', 'fullName');

  try {
    const signUpResult = await cognitoClient.send(
      new SignUpCommand({
        ClientId: CLIENT_ID,
        Username: body.email,
        Password: body.password,
        UserAttributes: [
          { Name: 'email', Value: body.email },
          { Name: 'name', Value: fullName },
        ],
      }),
    );

    const userId = signUpResult.UserSub!;
    const now = new Date().toISOString();

    // Seed minimal UserProfile in DynamoDB; fiscal fields filled later via PUT /profile
    await docClient.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          entityType: 'UserProfile',
          userId,
          email: body.email,
          fullName,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    return created({
      message: 'Registration successful. Check your email for verification.',
      userId,
    });
  } catch (err: unknown) {
    const name = cognitoErrorName(err);
    if (name === 'UsernameExistsException')
      return conflict('An account with this email address already exists.');
    if (name === 'InvalidPasswordException' || name === 'InvalidParameterException')
      return badRequest('VALIDATION_ERROR', 'Password does not meet the minimum security requirements.');
    throw err;
  }
}

async function verify(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ email?: string; confirmationCode?: string }>(event);

  if (!body.email || !EMAIL_RE.test(body.email))
    return badRequest('VALIDATION_ERROR', 'Invalid email address.', 'email');

  if (!body.confirmationCode || body.confirmationCode.trim() === '')
    return badRequest('VALIDATION_ERROR', 'confirmationCode is required.', 'confirmationCode');

  try {
    await cognitoClient.send(
      new ConfirmSignUpCommand({
        ClientId: CLIENT_ID,
        Username: body.email,
        ConfirmationCode: body.confirmationCode.trim(),
      }),
    );

    return ok({ message: 'Email verified. You can now log in.' });
  } catch (err: unknown) {
    const name = cognitoErrorName(err);
    if (name === 'CodeMismatchException' || name === 'ExpiredCodeException')
      return badRequest('VALIDATION_ERROR', 'Invalid or expired verification code.', 'confirmationCode');
    if (name === 'UserNotFoundException')
      return notFound('No account found with this email address.');
    if (name === 'NotAuthorizedException')
      return badRequest('VALIDATION_ERROR', 'Account is already confirmed.');
    throw err;
  }
}

async function login(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ email?: string; password?: string }>(event);

  if (!body.email || !EMAIL_RE.test(body.email))
    return badRequest('VALIDATION_ERROR', 'Invalid email address.', 'email');

  if (!body.password)
    return badRequest('VALIDATION_ERROR', 'password is required.', 'password');

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: body.email,
          PASSWORD: body.password,
        },
      }),
    );

    const auth = result.AuthenticationResult!;
    return ok({
      accessToken: auth.IdToken,
      refreshToken: auth.RefreshToken,
      expiresIn: auth.ExpiresIn,
      tokenType: auth.TokenType ?? 'Bearer',
    });
  } catch (err: unknown) {
    const name = cognitoErrorName(err);
    if (name === 'NotAuthorizedException' || name === 'UserNotFoundException')
      return unauthorized('Incorrect email or password.');
    if (name === 'UserNotConfirmedException')
      return forbidden(
        'Email address has not been verified. Check your inbox for the verification code.',
      );
    throw err;
  }
}

async function refreshToken(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<{ refreshToken?: string }>(event);

  if (!body.refreshToken || body.refreshToken.trim() === '')
    return badRequest('VALIDATION_ERROR', 'refreshToken is required.', 'refreshToken');

  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: body.refreshToken,
        },
      }),
    );

    const auth = result.AuthenticationResult!;
    return ok({
      accessToken: auth.IdToken,
      expiresIn: auth.ExpiresIn,
      tokenType: auth.TokenType ?? 'Bearer',
    });
  } catch (err: unknown) {
    const name = cognitoErrorName(err);
    if (name === 'NotAuthorizedException')
      return unauthorized('Refresh token has expired. Please log in again.');
    throw err;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const log = createLogger('auth', context.awsRequestId, getUserId(event));
  const { httpMethod: method, resource } = event;

  try {
    if (resource === '/auth/register' && method === 'POST') return await register(event);
    if (resource === '/auth/verify' && method === 'POST') return await verify(event);
    if (resource === '/auth/login' && method === 'POST') return await login(event);
    if (resource === '/auth/refresh' && method === 'POST') return await refreshToken(event);

    if (resource === '/profile') {
      if (method === 'GET') return await getProfile(event);
      if (method === 'PUT') return await updateProfile(event);
    }

    return notFound('Endpoint not found.');
  } catch (err) {
    log.error('Unhandled error', err);
    return internalError();
  }
};
