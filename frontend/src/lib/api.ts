const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

// Token stored in memory for XSS safety; sessionStorage used for tab persistence
let memoryToken: string | null = null;

export function setToken(token: string): void {
  memoryToken = token;
  try {
    sessionStorage.setItem('playgen_token', token);
  } catch {
    // sessionStorage not available (SSR or private browsing)
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = sessionStorage.getItem('playgen_token');
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch {
    // sessionStorage not available
  }
  return null;
}

export function clearToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem('playgen_token');
  } catch {
    // sessionStorage not available
  }
}

export interface ApiError {
  status: number;
  message: string;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw { status: 401, message: 'Unauthorized' } satisfies ApiError;
  }

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Non-JSON error body
    }
    throw { status: response.status, message } satisfies ApiError;
  }

  // Handle empty responses (e.g., 204 No Content)
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string): Promise<T> => apiFetch<T>(path),

  post: <T>(path: string, body: unknown): Promise<T> =>
    apiFetch<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  put: <T>(path: string, body: unknown): Promise<T> =>
    apiFetch<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string): Promise<T> =>
    apiFetch<T>(path, { method: 'DELETE' }),

  postForm: <T>(path: string, formData: FormData): Promise<T> => {
    // Do NOT set Content-Type — browser sets it with the boundary
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    }).then(async (response) => {
      if (response.status === 401) {
        clearToken();
        if (typeof window !== 'undefined') window.location.href = '/login';
        throw { status: 401, message: 'Unauthorized' } satisfies ApiError;
      }
      if (!response.ok) {
        let message = response.statusText;
        try {
          const b = (await response.json()) as { message?: string; error?: string };
          message = b.message ?? b.error ?? message;
        } catch { /* non-JSON */ }
        throw { status: response.status, message } satisfies ApiError;
      }
      if (response.status === 204) return undefined as unknown as T;
      return response.json() as Promise<T>;
    });
  },
};
