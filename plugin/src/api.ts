/**
 * Minimal client for the Agent Trust Passport backend.
 *
 * Plugins have no memory between calls, so passports live in an external
 * service. Rules followed here:
 *  - nothing runs at module startup; the base URL is read per call
 *  - every request is bounded (7s timeout, 64 KiB response)
 *  - the plugin never sets credentials: if the backend needs a token, PayBox
 *    injects it as a brokered header for the allow-listed host
 *  - redirects are refused so a brokered header can never follow a redirect
 */

export const AGENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
export const REQUEST_TIMEOUT_MS = 7_000;
const MAX_RESPONSE_CHARS = 64 * 1024;

export class ApiError extends Error {}

export interface Deps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}

export function defaultDeps(): Deps {
  return { fetch: globalThis.fetch, env: process.env };
}

export function baseUrl(env: Record<string, string | undefined>): string {
  const raw = env.PASSPORT_API_URL?.trim();
  if (!raw) {
    throw new ApiError("The passport service is not configured. Set the PASSPORT_API_URL variable in the plugin settings.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError("PASSPORT_API_URL is not a valid URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ApiError("PASSPORT_API_URL must use https.");
  }
  if (url.username || url.password) {
    throw new ApiError("PASSPORT_API_URL must not contain credentials.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export async function callApi(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  deps: Deps,
): Promise<unknown> {
  const url = `${baseUrl(deps.env)}${path}`;
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new ApiError("Could not reach the passport service (network error or timeout).");
  }

  if (Number(res.headers.get("content-length") ?? 0) > MAX_RESPONSE_CHARS) {
    throw new ApiError("The passport service response was too large.");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError("Could not read the passport service response.");
  }
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new ApiError("The passport service response was too large.");
  }

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const detail =
      typeof json === "object" && json !== null && "error" in json ? (json as { error?: unknown }).error : undefined;
    throw new ApiError(
      `The passport service rejected the request (HTTP ${res.status})` +
        (typeof detail === "string" && detail.length <= 200 ? `: ${detail}` : "."),
    );
  }
  if (json === undefined) throw new ApiError("The passport service returned an invalid response.");
  return json;
}
