import type { Context } from "hono";

export interface SuccessResponse<T = unknown> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

export function success<T>(c: Context, data: T, status: 200 | 201 = 200) {
  const requestId = (c.get("requestId") as string) || "unknown";
  const body: SuccessResponse<T> = {
    ok: true,
    data,
    requestId,
  };
  return c.json(body, status);
}

export function error(
  c: Context,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 500 = 500
) {
  const requestId = (c.get("requestId") as string) || "unknown";
  const body: ErrorResponse = {
    ok: false,
    error: { code, message },
    requestId,
  };
  return c.json(body, status);
}
