/**
 * Tipos de la parte de autocannon 8 que usa `carga.ts`. El paquete no publica los suyos, y los de
 * DefinitelyTyped describen la versión 7.
 */
declare module "autocannon" {
  import { EventEmitter } from "node:events";

  namespace autocannon {
    interface Request {
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      body?: string;
      setupRequest?: (request: Request) => Request;
    }

    interface Options {
      url: string;
      connections?: number;
      duration?: number;
      pipelining?: number;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      requests?: Request[];
    }

    interface Histogram {
      average: number;
      mean: number;
      stddev: number;
      min: number;
      max: number;
      total: number;
      p50: number;
      p90: number;
      p97_5: number;
      p99: number;
    }

    interface Result {
      url: string;
      connections: number;
      pipelining: number;
      duration: number;
      start: Date;
      finish: Date;
      errors: number;
      timeouts: number;
      non2xx: number;
      "1xx": number;
      "2xx": number;
      "3xx": number;
      "4xx": number;
      "5xx": number;
      latency: Histogram;
      requests: Histogram & { sent: number };
      throughput: Histogram;
    }

    interface Instance extends EventEmitter {
      stop(): void;
    }
  }

  function autocannon(
    options: autocannon.Options,
    callback: (error: Error | null, result: autocannon.Result) => void,
  ): autocannon.Instance;

  export = autocannon;
}
