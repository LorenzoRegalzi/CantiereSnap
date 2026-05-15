export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  'https://ec0ws3spi8.execute-api.eu-south-1.amazonaws.com/staging';

// Cognito — API Gateway expects the ID token (not the access token)
export const ID_TOKEN_KEY = 'cs_id_token';
export const REFRESH_TOKEN_KEY = 'cs_refresh_token';

export const COGNITO_REGION = process.env.NEXT_PUBLIC_COGNITO_REGION ?? 'eu-south-1';
export const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '49k1v94dcoe1jvikn41q00ro4m';

export const APP_NAME = 'CantiereSnap';
export const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? 'development';
