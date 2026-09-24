/**
 * Minimal Markaestro public API client for the MCP server.
 *
 * Deliberately self-contained (no dependency on @markaestro/sdk) so the MCP
 * package installs with `npx` alone. It keeps the two behaviours that matter
 * for an agent driving the API unattended: every mutation carries an
 * Idempotency-Key minted once per call, so a retry replays instead of
 * double-posting, and 429/5xx are retried with the server's Retry-After.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { VERSION } from "./version";

export const DEFAULT_BASE_URL = "https://markaestro.com";

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
/** API calls are short; uploads to storage get longer. */
export const REQUEST_TIMEOUT_MS = 60_000;
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

export class MarkaestroApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage?: string;
  readonly requestId?: string;
  readonly issues?: Array<{ channel?: string; code?: string; message: string }>;
  readonly retryAfterSeconds?: number;

  constructor(status: number, body: Record<string, unknown>, retryAfter?: string | null) {
    const code = typeof body.error === "string" ? body.error : `HTTP_${status}`;
    const message = typeof body.message === "string" ? body.message : typeof body.userMessage === "string" ? body.userMessage : code;
    super(message);
    this.name = "MarkaestroApiError";
    this.status = status;
    this.code = code;
    if (typeof body.userMessage === "string") this.userMessage = body.userMessage;
    if (typeof body.requestId === "string") this.requestId = body.requestId;
    if (Array.isArray(body.issues)) this.issues = body.issues as MarkaestroApiError["issues"];
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) this.retryAfterSeconds = seconds;
  }
}

export type ClientOptions = {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injected for tests; defaults to the real sleep. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Whether `uploadMedia` may read a local file path. True for the stdio
   * package, where "local" is the user's machine. The hosted endpoint sets it
   * false: there, "local" would be the server's own disk.
   */
  allowLocalFiles?: boolean;
  /**
   * Downloads an http(s) `uploadMedia` source. Defaults to plain fetch; the
   * hosted endpoint passes one that refuses private addresses and caps size.
   */
  downloadUrl?: (url: string) => Promise<Response>;
};

export type Query = Record<string, string | number | boolean | undefined>;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

export function contentTypeFor(fileName: string): string | null {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? null;
}

export class MarkaestroClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly allowLocalFiles: boolean;
  private readonly downloadUrl: (url: string) => Promise<Response>;

  constructor(options: ClientOptions) {
    if (!/^mk_(live|test)_/.test(options.apiKey ?? "")) {
      throw new Error("MARKAESTRO_API_KEY must be an mk_live_ or mk_test_ key from Settings > API Access");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.allowLocalFiles = options.allowLocalFiles ?? true;
    const fetchImpl = this.fetchImpl;
    this.downloadUrl = options.downloadUrl ?? ((url) => fetchImpl(url, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) }));
  }

  get isTestKey(): boolean {
    return this.apiKey.startsWith("mk_test_");
  }

  /** Whether `uploadMedia` accepts a local file path (false on the hosted endpoint). */
  get readsLocalFiles(): boolean {
    return this.allowLocalFiles;
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `markaestro-mcp/${VERSION}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      headers["Idempotency-Key"] = `mk_idem_${randomBytes(16).toString("hex")}`;
    }
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 2 ** attempt;
        await this.sleep(retryAfter * 1000);
        continue;
      }
      const text = await response.text();
      let parsed: Record<string, unknown>;
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = { error: "MALFORMED_RESPONSE", message: text.slice(0, 200) };
      }
      if (!response.ok) throw new MarkaestroApiError(response.status, parsed, response.headers.get("Retry-After"));
      return parsed as T;
    }
  }

  /**
   * Three-step direct upload: create a session, PUT the bytes to storage,
   * finalize. Returns the media asset. `source` is a local path, an http(s)
   * URL, or base64 bytes.
   */
  async uploadMedia(input: {
    source: string;
    fileName?: string;
    contentType?: string;
  }): Promise<Record<string, unknown>> {
    const { bytes, fileName, contentType } = await loadBytes(input, {
      allowLocalFiles: this.allowLocalFiles,
      downloadUrl: this.downloadUrl,
    });
    const session = await this.request<{ uploadSession: { id: string; uploadUrl: string; uploadMethod?: string; uploadHeaders?: Record<string, string> } }>(
      "POST",
      "/api/public/v1/media/upload-sessions",
      { fileName, contentType, sizeBytes: bytes.byteLength },
    );
    const { uploadUrl, uploadMethod, uploadHeaders, id } = session.uploadSession;
    // The storage URL is pre-signed: no API key goes there.
    const put = await this.fetchImpl(uploadUrl, {
      method: uploadMethod ?? "PUT",
      headers: { "Content-Type": contentType, ...(uploadHeaders ?? {}) },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      // Node's fetch accepts a Uint8Array; the DOM lib typing lags behind.
      body: bytes as unknown as BodyInit,
    });
    if (!put.ok) {
      throw new MarkaestroApiError(put.status, { error: "UPLOAD_PUT_FAILED", message: `Storage refused the upload (${put.status}).` });
    }
    const finalized = await this.request<{ asset: Record<string, unknown> }>(
      "POST",
      `/api/public/v1/media/upload-sessions/${encodeURIComponent(id)}/finalize`,
    );
    return finalized.asset;
  }
}

async function loadBytes(
  input: { source: string; fileName?: string; contentType?: string },
  sources: { allowLocalFiles: boolean; downloadUrl: (url: string) => Promise<Response> },
): Promise<{ bytes: Uint8Array; fileName: string; contentType: string }> {
  const { source } = input;
  let bytes: Uint8Array;
  let fileName = input.fileName;
  if (/^https?:\/\//i.test(source)) {
    const response = await sources.downloadUrl(source);
    if (!response.ok) throw new Error(`Could not download ${source} (${response.status})`);
    bytes = new Uint8Array(await response.arrayBuffer());
    fileName ??= basename(new URL(source).pathname) || "upload";
    input.contentType ??= response.headers.get("Content-Type")?.split(";")[0] ?? undefined;
  } else if (/^data:/.test(source)) {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(source);
    if (!match) throw new Error("Malformed data: URL");
    bytes = match[2] ? new Uint8Array(Buffer.from(match[3], "base64")) : new TextEncoder().encode(decodeURIComponent(match[3]));
    input.contentType ??= match[1] || undefined;
    fileName ??= "upload";
  } else if (!sources.allowLocalFiles) {
    throw new Error("This server cannot read file paths. Pass an http(s) URL or a data: URL instead, or run the local @markaestro/mcp package to upload files from this machine.");
  } else {
    bytes = new Uint8Array(await readFile(source));
    fileName ??= basename(source);
  }
  const contentType = input.contentType ?? contentTypeFor(fileName);
  if (!contentType) {
    throw new Error(`Cannot infer the media type of ${fileName}; pass contentType (image/png, image/jpeg, image/webp, image/gif, video/mp4, video/quicktime, video/webm).`);
  }
  return { bytes, fileName, contentType };
}
