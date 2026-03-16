import { HttpError, internalError } from "./errors";

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

export function text(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

export function html(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "bad_request", "Request body must be valid JSON");
  }
}

export function errorResponse(error: unknown): Response {
  const httpError =
    error instanceof HttpError
      ? error
      : internalError(error instanceof Error ? error.message : "Unexpected error");

  return json(
    {
      error: {
        code: httpError.code,
        message: httpError.message
      }
    },
    { status: httpError.status }
  );
}

export function isMethod(request: Request, method: string): boolean {
  return request.method.toUpperCase() === method.toUpperCase();
}

