import { AsyncLocalStorage } from "node:async_hooks";
import { describeUrl } from "../trace";

export type BackendTraceStage = "backend" | "sandbox" | "response";
export type BackendTraceLevel = "info" | "ok" | "warn" | "error";

export interface BackendTraceStep {
  at: string;
  stage: BackendTraceStage;
  level: BackendTraceLevel;
  label: string;
  detail: string;
  durationMs?: number;
}

const storage = new AsyncLocalStorage<BackendTraceStep[]>();
let activeCaptures = 0;
let baseFetch: typeof globalThis.fetch | undefined;
let wrappedFetch: typeof globalThis.fetch | undefined;

export function traceStep(
  stage: BackendTraceStage,
  level: BackendTraceLevel,
  label: string,
  detail: string,
  durationMs?: number,
): BackendTraceStep {
  return {
    at: new Date().toISOString(),
    stage,
    level,
    label,
    detail,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/** Lee solo el campo de estado nativo de una respuesta JSON sin consumir el cuerpo original. */
async function nativeStatusOf(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("json")) return undefined;
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown> | undefined;
    const status = data?.status ?? body.status;
    return typeof status === "string" ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ejecuta una operación del SDK capturando por petición las llamadas HTTP salientes hacia
 * la pasarela o el simulador, sin tocar el módulo de pagos ni exponer llaves o cuerpos.
 */
export async function captureBackendCalls<T>(
  operation: () => Promise<T>,
): Promise<{ result?: T; error?: unknown; steps: BackendTraceStep[] }> {
  const steps: BackendTraceStep[] = [];
  if (activeCaptures === 0) {
    const currentFetch = globalThis.fetch;
    baseFetch = currentFetch;
    wrappedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const bucket = storage.getStore();
      if (!bucket) return currentFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const target = describeUrl(url);
      const started = Date.now();
      try {
        const response = await currentFetch(input, init);
        const durationMs = Date.now() - started;
        const nativeStatus = await nativeStatusOf(response);
        bucket.push(
          traceStep(
            "sandbox",
            response.ok ? "ok" : "warn",
            `${method} ${target}`,
            `HTTP ${response.status}${nativeStatus ? ` · nativo ${nativeStatus}` : ""}`,
            durationMs,
          ),
        );
        return response;
      } catch (error) {
        const durationMs = Date.now() - started;
        bucket.push(
          traceStep(
            "sandbox",
            "error",
            `${method} ${target}`,
            `Error de red: ${error instanceof Error ? error.message : String(error)}`,
            durationMs,
          ),
        );
        throw error;
      }
    };
    globalThis.fetch = wrappedFetch;
  }
  activeCaptures += 1;
  try {
    const result = await storage.run(steps, operation);
    return { result, steps };
  } catch (error) {
    return { error, steps };
  } finally {
    activeCaptures -= 1;
    if (activeCaptures === 0) {
      if (globalThis.fetch === wrappedFetch && baseFetch) {
        globalThis.fetch = baseFetch;
      }
      baseFetch = undefined;
      wrappedFetch = undefined;
    }
  }
}
