import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { getIdToken, getRefreshToken, storeTokens, clearTokens } from './auth';
import { API_BASE_URL } from './constants';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Queues callers waiting for a token refresh to complete.
let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function flushQueue(error: unknown, token: string | null = null): void {
  refreshQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token!)));
  refreshQueue = [];
}

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach Cognito ID token — required by API Gateway JWT authorizer.
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getIdToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Skip refresh for auth endpoints — they're unauthenticated by design, and a 401
    // from /auth/login means wrong credentials, not an expired session.
    if (error.response?.status === 401 && !original._retry && !original.url?.startsWith('/auth/')) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return apiClient(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearTokens();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post<{ idToken: string; refreshToken?: string }>(
          `${API_BASE_URL}/auth/refresh`,
          { refreshToken }
        );
        storeTokens(data.idToken, data.refreshToken ?? refreshToken);
        flushQueue(null, data.idToken);
        original.headers.Authorization = `Bearer ${data.idToken}`;
        return apiClient(original);
      } catch (refreshError) {
        flushQueue(refreshError, null);
        clearTokens();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    const body = error.response?.data as {
      error?: { code: string; message: string; field?: string };
    };
    if (body?.error) {
      throw new ApiError(
        body.error.code,
        body.error.message,
        body.error.field,
        error.response?.status
      );
    }

    throw error;
  }
);

export async function fetchAllPages<T>(
  url: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;

  do {
    const { data } = await apiClient.get<{ items: T[]; nextToken?: string }>(url, {
      params: { ...params, ...(nextToken ? { nextToken } : {}) },
    });
    items.push(...data.items);
    nextToken = data.nextToken;
  } while (nextToken);

  return items;
}

export default apiClient;
