import type { APIGatewayProxyEvent } from 'aws-lambda';
import { docClient } from '../../shared/dynamodb';
import { getPresignedUrl, putPresignedUrl } from '../../shared/s3';
import { anthropicClient } from '../../shared/anthropic';
import { handler } from '../photos.handler';

jest.mock('../../shared/dynamodb', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('../../shared/s3', () => ({
  getPresignedUrl: jest.fn(),
  putPresignedUrl: jest.fn(),
}));

jest.mock('../../shared/anthropic', () => ({
  anthropicClient: { messages: { create: jest.fn() } },
}));

jest.mock('../../shared/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ctx = { awsRequestId: 'test-request-id' } as never;


const mockDynamo = docClient.send as jest.Mock;
const mockGetPresignedUrl = getPresignedUrl as jest.Mock;
const mockPutPresignedUrl = putPresignedUrl as jest.Mock;
const mockAnthropic = anthropicClient.messages.create as jest.Mock;

// ── Test helpers ──────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';
const JOB_ID = '3';
const JOB_ID_PADDED = '00003';
const PHOTO_ID = 'ABCDEF12345678901234567890';

const makeEvent = (
  method: string,
  resource: string,
  body: unknown = null,
  pathParameters: Record<string, string> | null = { jobId: JOB_ID },
): APIGatewayProxyEvent =>
  ({
    httpMethod: method,
    resource,
    path: resource,
    pathParameters,
    queryStringParameters: null,
    body: body !== null ? JSON.stringify(body) : null,
    requestContext: { authorizer: { claims: { sub: USER_ID } } },
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    multiValueQueryStringParameters: null,
    stageVariables: null,
  }) as unknown as APIGatewayProxyEvent;

const makePhotoEvent = (method: string, resource: string, body: unknown = null) =>
  makeEvent(method, resource, body, { jobId: JOB_ID, photoId: PHOTO_ID });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JOB_ITEM = {
  PK: `USER#${USER_ID}`,
  SK: `JOB#${JOB_ID_PADDED}`,
  status: 'InProgress',
  clientName: 'Luigi Bianchi',
};

const PHOTO_ITEM = {
  PK: `JOB#${USER_ID}#${JOB_ID_PADDED}`,
  SK: `PHOTO#${PHOTO_ID}`,
  entityType: 'Photo',
  photoId: PHOTO_ID,
  s3Key: `users/${USER_ID}/jobs/${JOB_ID_PADDED}/photos/${PHOTO_ID}.jpg`,
  tag: 'Before',
  mimeType: 'image/jpeg',
  sizeBytes: 3245000,
  aiDescription: 'Tubazioni in rame ossidate visibili sotto il lavabo.',
  aiDescriptionEdited: false,
  uploadedAt: '2026-05-07T10:00:00.000Z',
};

const UPLOAD_URL = 'https://s3.eu-south-1.amazonaws.com/bucket/key?X-Amz-Signature=test';
const DOWNLOAD_URL = 'https://s3.eu-south-1.amazonaws.com/bucket/key?X-Amz-Signature=download';
const AI_DESCRIPTION = 'Tubazioni in rame ossidate visibili sotto il lavabo esistente.';

const VALID_UPLOAD_BODY = {
  fileName: 'bagno_prima.jpg',
  mimeType: 'image/jpeg',
  tag: 'Before',
};

const VALID_SAVE_BODY = {
  photoId: PHOTO_ID,
  s3Key: `users/${USER_ID}/jobs/${JOB_ID_PADDED}/photos/${PHOTO_ID}.jpg`,
  tag: 'Before',
  mimeType: 'image/jpeg',
  sizeBytes: 3245000,
};

// ── POST /jobs/{jobId}/photos/upload-url ──────────────────────────────────────

describe('POST /jobs/{jobId}/photos/upload-url — generateUploadUrl', () => {
  beforeEach(() => {
    mockPutPresignedUrl.mockResolvedValue(UPLOAD_URL);
  });

  it('returns 200 with photoId, uploadUrl, method, and headers', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', VALID_UPLOAD_BODY), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.photoId).toBeDefined();
    expect(body.photoId).toHaveLength(26);
    expect(body.uploadUrl).toBe(UPLOAD_URL);
    expect(body.expiresIn).toBe(900);
    expect(body.method).toBe('PUT');
    expect(body.headers['Content-Type']).toBe('image/jpeg');
    expect(body.headers['x-amz-meta-tag']).toBe('Before');
  });

  it('calls putPresignedUrl with 900-second expiry', async () => {
    await handler(makeEvent('POST', '/jobs/{jobId}/photos/upload-url', VALID_UPLOAD_BODY), ctx);

    expect(mockPutPresignedUrl).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringContaining(`users/${USER_ID}/jobs/${JOB_ID_PADDED}/photos/`),
      'image/jpeg',
      900,
    );
  });

  it('constructs S3 key with correct path and jpg extension for image/jpeg', async () => {
    await handler(makeEvent('POST', '/jobs/{jobId}/photos/upload-url', VALID_UPLOAD_BODY), ctx);

    const body = JSON.parse((await handler(makeEvent('POST', '/jobs/{jobId}/photos/upload-url', VALID_UPLOAD_BODY), ctx)).body);
    expect(body.s3Key).toMatch(
      new RegExp(`^users/${USER_ID}/jobs/${JOB_ID_PADDED}/photos/.+\\.jpg$`),
    );
  });

  it('accepts image/png and uses png extension', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', {
        fileName: 'foto.png',
        mimeType: 'image/png',
        tag: 'After',
      }), ctx);
    const body = JSON.parse(res.body);
    expect(body.s3Key).toMatch(/\.png$/);
  });

  it('returns 400 when fileName is missing', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', { mimeType: 'image/jpeg', tag: 'Before' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('fileName');
  });

  it('returns 400 for invalid file extension', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', {
        fileName: 'photo.gif',
        mimeType: 'image/jpeg',
        tag: 'Before',
      }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('fileName');
  });

  it('returns 400 for unsupported mimeType', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', {
        fileName: 'photo.jpg',
        mimeType: 'image/gif',
        tag: 'Before',
      }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('mimeType');
  });

  it('returns 400 for invalid tag', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', {
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        tag: 'During',
      }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('tag');
  });

  it('returns 500 on unexpected error', async () => {
    mockPutPresignedUrl.mockRejectedValueOnce(new Error('S3 error'));
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', VALID_UPLOAD_BODY), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── POST /jobs/{jobId}/photos — savePhoto ─────────────────────────────────────

describe('POST /jobs/{jobId}/photos — savePhoto', () => {
  beforeEach(() => {
    mockGetPresignedUrl.mockResolvedValue(DOWNLOAD_URL);
    mockAnthropic.mockResolvedValue({
      content: [{ type: 'text', text: AI_DESCRIPTION }],
    });
  });

  it('returns 201 with photo metadata and AI description', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })  // GetItem job
      .mockResolvedValueOnce({})                  // PutItem photo
      .mockResolvedValueOnce({});                  // UpdateItem AI description

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/photos', VALID_SAVE_BODY), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.photoId).toBe(PHOTO_ID);
    expect(body.tag).toBe('Before');
    expect(body.imageUrl).toBe(DOWNLOAD_URL);
    expect(body.aiDescription).toBe(AI_DESCRIPTION);
    expect(body.uploadedAt).toBeDefined();
  });

  it('saves photo to DynamoDB with correct PK/SK and entityType', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/jobs/{jobId}/photos', VALID_SAVE_BODY), ctx);

    const putInput = mockDynamo.mock.calls[1][0].input;
    expect(putInput.Item.PK).toBe(`JOB#${USER_ID}#${JOB_ID_PADDED}`);
    expect(putInput.Item.SK).toBe(`PHOTO#${PHOTO_ID}`);
    expect(putInput.Item.entityType).toBe('Photo');
    expect(putInput.Item.photoId).toBe(PHOTO_ID);
    expect(putInput.Item.tag).toBe('Before');
    expect(putInput.Item.aiDescription).toBeNull();
  });

  it('calls Claude with presigned image URL and correct model', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler(makeEvent('POST', '/jobs/{jobId}/photos', VALID_SAVE_BODY), ctx);

    const aiCall = mockAnthropic.mock.calls[0][0];
    expect(aiCall.model).toBe('claude-sonnet-4-20250514');
    expect(aiCall.max_tokens).toBe(300);
    expect(aiCall.messages[0].content[0].type).toBe('image');
    expect(aiCall.messages[0].content[0].source.url).toBe(DOWNLOAD_URL);
  });

  it('returns 201 without description when AI call fails (graceful degradation)', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: JOB_ITEM })
      .mockResolvedValueOnce({});

    mockAnthropic.mockRejectedValueOnce(new Error('Claude API unavailable'));
    mockGetPresignedUrl.mockResolvedValue(DOWNLOAD_URL);

    const res = await handler(makeEvent('POST', '/jobs/{jobId}/photos', VALID_SAVE_BODY), ctx);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.aiDescription).toBeNull();
    // PutItem was called but UpdateItem (AI update) was NOT called
    expect(mockDynamo.mock.calls).toHaveLength(2); // GetItem + PutItem only
  });

  it('rejects s3Key that does not belong to the current user', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos', {
        ...VALID_SAVE_BODY,
        s3Key: 'users/other-user/jobs/00003/photos/test.jpg',
      }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('s3Key');
  });

  it('returns 400 when photoId is missing', async () => {
    const { photoId: _p, ...body } = VALID_SAVE_BODY;
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/photos', body), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('photoId');
  });

  it('returns 400 when s3Key is missing', async () => {
    const { s3Key: _s, ...body } = VALID_SAVE_BODY;
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/photos', body), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('s3Key');
  });

  it('returns 400 when tag is invalid', async () => {
    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos', { ...VALID_SAVE_BODY, tag: 'During' }), ctx);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.field).toBe('tag');
  });

  it('returns 404 when job not found', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/photos', VALID_SAVE_BODY), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB down'));
    const res = await handler(makeEvent('POST', '/jobs/{jobId}/photos', VALID_SAVE_BODY), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /jobs/{jobId}/photos — listPhotos ─────────────────────────────────────

describe('GET /jobs/{jobId}/photos — listPhotos', () => {
  beforeEach(() => {
    mockGetPresignedUrl.mockResolvedValue(DOWNLOAD_URL);
  });

  it('returns 200 with photos sorted by uploadedAt', async () => {
    const photo2 = { ...PHOTO_ITEM, photoId: 'PHOTO2', uploadedAt: '2026-05-07T12:00:00.000Z' };
    mockDynamo.mockResolvedValueOnce({ Items: [photo2, PHOTO_ITEM] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/photos'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].photoId).toBe(PHOTO_ID); // earlier uploadedAt
    expect(body.items[1].photoId).toBe('PHOTO2');
  });

  it('includes presigned imageUrl for each photo', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [PHOTO_ITEM] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/photos'), ctx);
    const body = JSON.parse(res.body);
    expect(body.items[0].imageUrl).toBe(DOWNLOAD_URL);
    expect(mockGetPresignedUrl).toHaveBeenCalledWith('test-bucket', PHOTO_ITEM.s3Key);
  });

  it('returns empty array when no photos exist', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/photos'), ctx);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(0);
  });

  it('queries with PHOTO# prefix and filters soft-deleted items', async () => {
    mockDynamo.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent('GET', '/jobs/{jobId}/photos'), ctx);

    const queryInput = mockDynamo.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[':pk']).toBe(
      `JOB#${USER_ID}#${JOB_ID_PADDED}`,
    );
    expect(queryInput.ExpressionAttributeValues[':prefix']).toBe('PHOTO#');
    expect(queryInput.FilterExpression).toBe('attribute_not_exists(deletedAt)');
  });

  it('returns null for aiDescription when not yet generated', async () => {
    const photoNoDesc = { ...PHOTO_ITEM, aiDescription: null };
    mockDynamo.mockResolvedValueOnce({ Items: [photoNoDesc] });

    const res = await handler(makeEvent('GET', '/jobs/{jobId}/photos'), ctx);
    const body = JSON.parse(res.body);
    expect(body.items[0].aiDescription).toBeNull();
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB error'));
    const res = await handler(makeEvent('GET', '/jobs/{jobId}/photos'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── GET /jobs/{jobId}/photos/{photoId} — getPhoto ────────────────────────────

describe('GET /jobs/{jobId}/photos/{photoId} — getPhoto', () => {
  beforeEach(() => {
    mockGetPresignedUrl.mockResolvedValue(DOWNLOAD_URL);
  });

  it('returns 200 with photo and presigned URL', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: PHOTO_ITEM });

    const res = await handler(
      makePhotoEvent('GET', '/jobs/{jobId}/photos/{photoId}'), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.photoId).toBe(PHOTO_ID);
    expect(body.tag).toBe('Before');
    expect(body.imageUrl).toBe(DOWNLOAD_URL);
    expect(body.aiDescription).toBe(PHOTO_ITEM.aiDescription);
  });

  it('returns 404 when photo does not exist', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makePhotoEvent('GET', '/jobs/{jobId}/photos/{photoId}'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for soft-deleted photos', async () => {
    const deletedPhoto = { ...PHOTO_ITEM, deletedAt: '2026-05-07T11:00:00.000Z' };
    mockDynamo.mockResolvedValueOnce({ Item: deletedPhoto });

    const res = await handler(makePhotoEvent('GET', '/jobs/{jobId}/photos/{photoId}'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB error'));
    const res = await handler(makePhotoEvent('GET', '/jobs/{jobId}/photos/{photoId}'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── DELETE /jobs/{jobId}/photos/{photoId} — deletePhoto ──────────────────────

describe('DELETE /jobs/{jobId}/photos/{photoId} — deletePhoto', () => {
  it('returns 204 and soft-deletes the photo', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: PHOTO_ITEM })   // GetItem
      .mockResolvedValueOnce({});                    // UpdateItem deletedAt

    const res = await handler(makePhotoEvent('DELETE', '/jobs/{jobId}/photos/{photoId}'), ctx);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('writes deletedAt via UpdateItem', async () => {
    mockDynamo
      .mockResolvedValueOnce({ Item: PHOTO_ITEM })
      .mockResolvedValueOnce({});

    await handler(makePhotoEvent('DELETE', '/jobs/{jobId}/photos/{photoId}'), ctx);

    const updateInput = mockDynamo.mock.calls[1][0].input;
    expect(updateInput.Key.PK).toBe(`JOB#${USER_ID}#${JOB_ID_PADDED}`);
    expect(updateInput.Key.SK).toBe(`PHOTO#${PHOTO_ID}`);
    expect(updateInput.UpdateExpression).toBe('SET deletedAt = :now');
    expect(updateInput.ExpressionAttributeValues[':now']).toBeDefined();
  });

  it('returns 404 when photo does not exist', async () => {
    mockDynamo.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makePhotoEvent('DELETE', '/jobs/{jobId}/photos/{photoId}'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when photo is already soft-deleted', async () => {
    const deletedPhoto = { ...PHOTO_ITEM, deletedAt: '2026-05-07T11:00:00.000Z' };
    mockDynamo.mockResolvedValueOnce({ Item: deletedPhoto });

    const res = await handler(makePhotoEvent('DELETE', '/jobs/{jobId}/photos/{photoId}'), ctx);
    expect(res.statusCode).toBe(404);
  });

  it('returns 500 on unexpected error', async () => {
    mockDynamo.mockRejectedValueOnce(new Error('DynamoDB down'));
    const res = await handler(makePhotoEvent('DELETE', '/jobs/{jobId}/photos/{photoId}'), ctx);
    expect(res.statusCode).toBe(500);
  });
});

// ── Bug regression tests ──────────────────────────────────────────────────────

describe('Regression: presigned URL must include x-amz-meta-tag header', () => {
  it('returns x-amz-meta-tag in the headers object so the client includes it in the S3 PUT', async () => {
    // Bug: the upload-url response omitted x-amz-meta-tag from the headers map.
    // The client sent the header to S3 without it being signed into the presigned URL,
    // causing S3 to reject the PUT with a SignatureDoesNotMatch error.
    // Fix: include x-amz-meta-tag: <tag> in the response headers so the client sends it
    // and S3 validates against the signed header value.
    mockPutPresignedUrl.mockResolvedValue(UPLOAD_URL);

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', VALID_UPLOAD_BODY), ctx);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.headers['x-amz-meta-tag']).toBe('Before');
  });

  it('reflects the correct tag value for After photos', async () => {
    mockPutPresignedUrl.mockResolvedValue(UPLOAD_URL);

    const res = await handler(
      makeEvent('POST', '/jobs/{jobId}/photos/upload-url', {
        fileName: 'bagno_dopo.jpg',
        mimeType: 'image/jpeg',
        tag: 'After',
      }), ctx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).headers['x-amz-meta-tag']).toBe('After');
  });
});
