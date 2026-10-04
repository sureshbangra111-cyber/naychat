/**
 * Typed API errors.
 *
 * Controllers throw these; a single error handler turns them into JSON. The
 * `publicMessage` is the ONLY thing ever shown to the browser — driver errors,
 * stack traces and database details never cross the boundary.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;

  constructor(status: number, code: string, publicMessage: string, internal?: unknown) {
    super(internal ? `${code}: ${String(internal)}` : code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new ApiError(400, code, message);

export const unauthorized = (message = 'Please sign in to continue.', code = 'unauthorized') =>
  new ApiError(401, code, message);

export const forbidden = (message = 'You do not have access to this resource.', code = 'forbidden') =>
  new ApiError(403, code, message);

export const notFound = (message = 'Not found.', code = 'not_found') =>
  new ApiError(404, code, message);

export const tooManyRequests = (message = 'Too many attempts. Please try again later.') =>
  new ApiError(429, 'rate_limited', message);

export const serviceUnavailable = (message = 'Chat is temporarily unavailable. Please try again.') =>
  new ApiError(503, 'service_unavailable', message);
