import type { APIGatewayProxyEvent } from 'aws-lambda';
import { cognitoClient } from '../../shared/cognito';
import { docClient } from '../../shared/dynamodb';
import { handler } from '../auth.handler';

jest.mock('../../shared/cognito', () => ({
  cognitoClient: { send: jest.fn() },
}));

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


const mockCognito = cognitoClient.send as jest.Mock;
const mockDynamo = docClient.send as jest.Mock;

// ── Test helpers ──────────────────────────────────────────────────────────────

const makeEvent = (
  method: string,
  resource: string,
  body: unknown = null,
): APIGatewayProxyEvent =>
  ({
    httpMethod: method,
    resource,
    path: resource,
    pathParameters: null,
    queryStringParameters: null,
    body: body !== null ? JSON.stringify(body) : null,
    requestContext: {},
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  }) as unknown as APIGatewayProxyEvent;

const makeAuthEvent = (
  method: string,
  resource: string,
  body: unknown = null,
  userId = 'user-abc-123',
): APIGatewayProxyEvent =>
  ({
    ...makeEvent(method, resource, body),
    requestContext: { authorizer: { claims: { sub: userId } } },
  }) as unknown as APIGatewayProxyEvent;

function cognitoError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_REGISTER_BODY = {
  email: 'marco.rossi@email.it',
  password: 'SecurePass123',
  fullName: 'Marco Rossi',
};

const VALID_LOGIN_BODY = {
  email: 'marco.rossi@email.it',
  password: 'SecurePass123',
};

const AUTH_RESULT = {
  IdToken: 'eyJraWQiOiJ.id.token',
  AccessToken: 'eyJraWQiOiJ.access.token',
  RefreshToken: 'eyJjdHkiOiJ.refresh.token',
  ExpiresIn: 3600,
  TokenType: 'Bearer',
};

const PROFILE_ITEM = {
  PK: 'USER#user-abc-123',
  SK: 'PROFILE',
  entityType: 'UserProfile',
  userId: 'user-abc-123',
  email: 'marco.rossi@email.it',
  fullName: 'Marco Rossi',
  businessName: 'Rossi Impianti',
  partitaIva: 'IT12345678901',
  codiceFiscale: 'RSSMRC85M01H501Z',
  regimeFiscale: 'RF19',
  address: { street: 'Via Roma 42', city: 'Carmagnola', province: 'TO', cap: '10022', country: 'IT' },
  phone: '+393331234567',
  createdAt: '2026-04-15T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

// ── POST /auth/register ───────────────────────────────────────────────────────

describe('POST /auth/register — register', () => {
  it('creates Cognito user and DynamoDB profile, returns 201', async () => {
    mockCognito.mockResolvedValueOnce({ UserSub: 'user-abc-123', UserConfirmed: false });
    mockDynamo.mockResolvedValueOnce({});

    const res = await handler(makeEvent('POST', '/auth/register', VALID_REGISTER_BODY), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('user-abc-123');
    expect(body.message).toContain('Registration successful');
  });

  it('writes profile to DynamoDB with correct PK and required fields', async () => {
    mockCognito.mockResolvedValueOnce({ UserSub: 'user-abc-123' });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/auth/register', VALID_REGISTER_BODY), ctx);

    const putInput = mockDynamo.mock.calls[0][0].input;
    expect(putInput.Item.PK).toBe('USER#user-abc-123');
    expect(putInput.Item.SK).toBe('PROFILE');
    expect(putInput.Item.entityType).toBe('UserProfile');
    expect(putInput.Item.email).toBe('marco.rossi@email.it');
    expect(putInput.Item.fullName).toBe('Marco Rossi');
    expect(putInput.Item.createdAt).toBeDefined();
  });

  it('sends correct attributes to Cognito SignUp', async () => {
    mockCognito.mockResolvedValueOnce({ UserSub: 'user-abc-123' });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/auth/register', VALID_REGISTER_BODY), ctx);

    const signUpInput = mockCognito.mock.calls[0][0].input;
    expect(signUpInput.ClientId).toBe('test-client-id');
    expect(signUpInput.Username).toBe('marco.rossi@email.it');
    expect(signUpInput.Password).toBe('SecurePass123');
    expect(signUpInput.UserAttributes).toContainEqual({ Name: 'email', Value: 'marco.rossi@email.it' });
  });

  it('returns 400 when email is missing', async () => {
    const { email: _e, ...body } = VALID_REGISTER_BODY;
    const res = await handler(makeEvent('POST', '/auth/register', body), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('email');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/register', { ...VALID_REGISTER_BODY, email: 'not-an-email' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('email');
  });

  it('returns 400 when password is too short', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/register', { ...VALID_REGISTER_BODY, password: 'short' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('password');
  });

  it('returns 400 when fullName is missing', async () => {
    const { fullName: _f, ...body } = VALID_REGISTER_BODY;
    const res = await handler(makeEvent('POST', '/auth/register', body), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('fullName');
  });

  it('returns 400 when fullName is too short', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/register', { ...VALID_REGISTER_BODY, fullName: 'X' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('fullName');
  });

  it('returns 400 when fullName exceeds 100 characters', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/register', { ...VALID_REGISTER_BODY, fullName: 'A'.repeat(101) }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('fullName');
  });

  it('returns 409 on UsernameExistsException', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('UsernameExistsException'));

    const res = await handler(makeEvent('POST', '/auth/register', VALID_REGISTER_BODY), ctx);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('returns 400 on InvalidPasswordException (Cognito password policy)', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('InvalidPasswordException'));

    const res = await handler(makeEvent('POST', '/auth/register', VALID_REGISTER_BODY), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 on unexpected error', async () => {
    mockCognito.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(makeEvent('POST', '/auth/register', VALID_REGISTER_BODY), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── POST /auth/verify ─────────────────────────────────────────────────────────

describe('POST /auth/verify — verify', () => {
  it('confirms email and returns 200 with success message', async () => {
    mockCognito.mockResolvedValueOnce({});

    const res = await handler(
      makeEvent('POST', '/auth/verify', { email: 'marco.rossi@email.it', confirmationCode: '482910' }), ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toContain('Email verified');
  });

  it('sends correct parameters to Cognito ConfirmSignUp', async () => {
    mockCognito.mockResolvedValueOnce({});

    await handler(
      makeEvent('POST', '/auth/verify', { email: 'marco.rossi@email.it', confirmationCode: '482910' }), ctx);

    const confirmInput = mockCognito.mock.calls[0][0].input;
    expect(confirmInput.ClientId).toBe('test-client-id');
    expect(confirmInput.Username).toBe('marco.rossi@email.it');
    expect(confirmInput.ConfirmationCode).toBe('482910');
  });

  it('returns 400 when email is missing', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/verify', { confirmationCode: '482910' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('email');
  });

  it('returns 400 when confirmationCode is missing', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/verify', { email: 'marco.rossi@email.it' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('confirmationCode');
  });

  it('returns 400 on CodeMismatchException', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('CodeMismatchException'));

    const res = await handler(
      makeEvent('POST', '/auth/verify', { email: 'marco.rossi@email.it', confirmationCode: '000000' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on ExpiredCodeException', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('ExpiredCodeException'));

    const res = await handler(
      makeEvent('POST', '/auth/verify', { email: 'marco.rossi@email.it', confirmationCode: '123456' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('confirmationCode');
  });

  it('returns 404 on UserNotFoundException', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('UserNotFoundException'));

    const res = await handler(
      makeEvent('POST', '/auth/verify', { email: 'nobody@email.it', confirmationCode: '123456' }), ctx);
    expect(res.statusCode).toBe(404);
  });
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /auth/login — login', () => {
  it('returns 200 with accessToken (ID token), refreshToken, expiresIn', async () => {
    mockCognito.mockResolvedValueOnce({ AuthenticationResult: AUTH_RESULT });

    const res = await handler(makeEvent('POST', '/auth/login', VALID_LOGIN_BODY), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBe(AUTH_RESULT.IdToken);
    expect(body.refreshToken).toBe(AUTH_RESULT.RefreshToken);
    expect(body.expiresIn).toBe(3600);
    expect(body.tokenType).toBe('Bearer');
  });

  it('uses USER_PASSWORD_AUTH flow with correct parameters', async () => {
    mockCognito.mockResolvedValueOnce({ AuthenticationResult: AUTH_RESULT });

    await handler(makeEvent('POST', '/auth/login', VALID_LOGIN_BODY), ctx);

    const authInput = mockCognito.mock.calls[0][0].input;
    expect(authInput.AuthFlow).toBe('USER_PASSWORD_AUTH');
    expect(authInput.AuthParameters.USERNAME).toBe('marco.rossi@email.it');
    expect(authInput.AuthParameters.PASSWORD).toBe('SecurePass123');
  });

  it('returns 400 when email is missing', async () => {
    const res = await handler(makeEvent('POST', '/auth/login', { password: 'SecurePass123' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('email');
  });

  it('returns 400 when password is missing', async () => {
    const res = await handler(
      makeEvent('POST', '/auth/login', { email: 'marco.rossi@email.it' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('password');
  });

  it('returns 401 on NotAuthorizedException (wrong credentials)', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('NotAuthorizedException'));

    const res = await handler(makeEvent('POST', '/auth/login', VALID_LOGIN_BODY), ctx);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on UserNotFoundException (treats as wrong credentials)', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('UserNotFoundException'));

    const res = await handler(makeEvent('POST', '/auth/login', VALID_LOGIN_BODY), ctx);
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 on UserNotConfirmedException', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('UserNotConfirmedException'));

    const res = await handler(makeEvent('POST', '/auth/login', VALID_LOGIN_BODY), ctx);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('returns 500 on unexpected error', async () => {
    mockCognito.mockRejectedValueOnce(new Error('Service unavailable'));

    const res = await handler(makeEvent('POST', '/auth/login', VALID_LOGIN_BODY), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────

describe('POST /auth/refresh — refreshToken', () => {
  it('returns 200 with new accessToken (ID token, no refreshToken in response)', async () => {
    mockCognito.mockResolvedValueOnce({
      AuthenticationResult: { IdToken: 'new.id.token', ExpiresIn: 3600, TokenType: 'Bearer' },
    });

    const res = await handler(
      makeEvent('POST', '/auth/refresh', { refreshToken: 'eyJjdHkiOiJ.refresh.token' }), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBe('new.id.token');
    expect(body.expiresIn).toBe(3600);
    expect(body.tokenType).toBe('Bearer');
    expect(body.refreshToken).toBeUndefined();
  });

  it('uses REFRESH_TOKEN_AUTH flow with correct parameters', async () => {
    mockCognito.mockResolvedValueOnce({
      AuthenticationResult: { AccessToken: 'new.access.token', ExpiresIn: 3600, TokenType: 'Bearer' },
    });

    await handler(
      makeEvent('POST', '/auth/refresh', { refreshToken: 'eyJjdHkiOiJ.refresh.token' }), ctx);

    const authInput = mockCognito.mock.calls[0][0].input;
    expect(authInput.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
    expect(authInput.AuthParameters.REFRESH_TOKEN).toBe('eyJjdHkiOiJ.refresh.token');
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await handler(makeEvent('POST', '/auth/refresh', {}), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('refreshToken');
  });

  it('returns 401 on NotAuthorizedException (expired token)', async () => {
    mockCognito.mockRejectedValueOnce(cognitoError('NotAuthorizedException'));

    const res = await handler(
      makeEvent('POST', '/auth/refresh', { refreshToken: 'expired.token' }), ctx);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 500 on unexpected error', async () => {
    mockCognito.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(
      makeEvent('POST', '/auth/refresh', { refreshToken: 'some.token' }), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /profile ──────────────────────────────────────────────────────────────

describe('GET /profile', () => {
  it('returns 200 with full profile', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PROFILE_ITEM });

    const res = await handler(makeAuthEvent('GET', '/profile'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('user-abc-123');
    expect(body.email).toBe('marco.rossi@email.it');
    expect(body.businessName).toBe('Rossi Impianti');
    expect(body.partitaIva).toBe('IT12345678901');
    expect(body.regimeFiscale).toBe('RF19');
    expect(body.address.city).toBe('Carmagnola');
  });

  it('queries DynamoDB with correct PK and SK', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PROFILE_ITEM });

    await handler(makeAuthEvent('GET', '/profile'), ctx);

    const getInput = mockDynamo.mock.calls[0][0].input;
    expect(getInput.Key).toEqual({ PK: 'USER#user-abc-123', SK: 'PROFILE' });
  });

  it('returns null for optional fields not yet set', async () => {
    const sparse = { ...PROFILE_ITEM, businessName: undefined, partitaIva: undefined, phone: undefined };
    mockDynamo.mockResolvedValueOnce({ Item: sparse });

    const res = await handler(makeAuthEvent('GET', '/profile'), ctx);
    const body = JSON.parse(res.body);
    expect(body.businessName).toBeNull();
    expect(body.partitaIva).toBeNull();
    expect(body.phone).toBeNull();
  });

  it('returns 404 when profile does not exist', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeAuthEvent('GET', '/profile'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on DynamoDB error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await handler(makeAuthEvent('GET', '/profile'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── PUT /profile ──────────────────────────────────────────────────────────────

describe('PUT /profile', () => {
  const VALID_UPDATE = {
    businessName: 'Rossi Impianti Idraulici',
    partitaIva: 'IT12345678901',
    codiceFiscale: 'RSSMRC85M01H501Z',
    regimeFiscale: 'RF19',
    phone: '+393331234567',
    address: { street: 'Via Roma 42', city: 'Carmagnola', province: 'TO', cap: '10022', country: 'IT' },
  };

  it('returns 200 with updated profile', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PROFILE_ITEM }); // GetCommand
    mockDynamo.mockResolvedValueOnce({});                     // UpdateCommand

    const res = await handler(makeAuthEvent('PUT', '/profile', VALID_UPDATE), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.businessName).toBe('Rossi Impianti Idraulici');
    expect(body.partitaIva).toBe('IT12345678901');
    expect(body.regimeFiscale).toBe('RF19');
  });

  it('uppercases codiceFiscale', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PROFILE_ITEM });
    mockDynamo.mockResolvedValueOnce({});

    const res = await handler(
      makeAuthEvent('PUT', '/profile', { codiceFiscale: 'rssmrc85m01h501z' }), ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).codiceFiscale).toBe('RSSMRC85M01H501Z');
  });

  it('trims whitespace from businessName and fullName', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PROFILE_ITEM });
    mockDynamo.mockResolvedValueOnce({});

    const res = await handler(
      makeAuthEvent('PUT', '/profile', { businessName: '  Rossi Impianti  ', fullName: '  Marco Rossi  ' }), ctx);

    const body = JSON.parse(res.body);
    expect(body.businessName).toBe('Rossi Impianti');
    expect(body.fullName).toBe('Marco Rossi');
  });

  it('issues UpdateCommand with correct key and expression', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PROFILE_ITEM });
    mockDynamo.mockResolvedValueOnce({});

    await handler(makeAuthEvent('PUT', '/profile', { phone: '+393331234567' }), ctx);

    const updateInput = mockDynamo.mock.calls[1][0].input;
    expect(updateInput.Key).toEqual({ PK: 'USER#user-abc-123', SK: 'PROFILE' });
    expect(updateInput.UpdateExpression).toContain('phone = :phone');
    expect(updateInput.ExpressionAttributeValues[':phone']).toBe('+393331234567');
  });

  it('returns 404 when profile does not exist', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeAuthEvent('PUT', '/profile', { phone: '+393331234567' }), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', {}), ctx);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid partitaIva format', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { partitaIva: '12345678901' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('partitaIva');
  });

  it('returns 400 for partitaIva missing IT prefix', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { partitaIva: 'FR12345678901' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('partitaIva');
  });

  it('returns 400 for codiceFiscale with wrong length', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { codiceFiscale: 'TOOSHORT' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('codiceFiscale');
  });

  it('returns 400 for invalid regimeFiscale code', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { regimeFiscale: 'RF99' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('regimeFiscale');
  });

  it('returns 400 for phone without + prefix', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { phone: '0039331234567' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('phone');
  });

  it('returns 400 for address missing required sub-fields', async () => {
    const res = await handler(
      makeAuthEvent('PUT', '/profile', { address: { street: 'Via Roma 42', city: 'Carmagnola' } }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('address');
  });

  it('returns 400 for businessName shorter than 2 characters', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { businessName: 'X' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('businessName');
  });

  it('returns 400 for fullName exceeding 100 characters', async () => {
    const res = await handler(makeAuthEvent('PUT', '/profile', { fullName: 'A'.repeat(101) }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('fullName');
  });

  it('returns 500 on DynamoDB error during get', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await handler(makeAuthEvent('PUT', '/profile', { phone: '+393331234567' }), ctx);
    expect(res.statusCode).toBe(500);
  });
});
