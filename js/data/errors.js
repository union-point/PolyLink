export class DataError extends Error {
  constructor(code, message, fieldErrors = {}, retryable = false) {
    super(message);
    this.name = 'DataError';
    Object.assign(this, { code, fieldErrors, retryable });
  }
}

export function normalizeError(error) {
  if (error instanceof DataError) return error;
  const status = error?.response?.status;
  const body = error?.response?.data;
  const codes = { 400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
  return new DataError(
    codes[status] || (status ? 'SERVICE_ERROR' : 'NETWORK'),
    body?.message || 'Չհաջողվեց կատարել գործողությունը։ Խնդրում ենք կրկին փորձել։',
    body?.fieldErrors || {},
    !status || status >= 500,
  );
}
