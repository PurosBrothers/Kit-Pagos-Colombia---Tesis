import http from "http";
import { AddressInfo, Socket } from "net";
import { KitPagos } from "./KitPagos";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

/**
 * Fallos HTTP y de red contra un servidor real, con el `fetch` nativo de Node (issue #122).
 *
 * No se sustituye `fetch` a propósito. Con un mock, `json()` y `text()` son funciones
 * independientes y el cuerpo se puede leer dos veces; con el `fetch` real, el primer intento
 * consume el cuerpo y el segundo falla con `TypeError: Body is unusable`. Además, dentro de
 * Jest los errores que crea el `fetch` de Node nacen en otro reino de JavaScript que el de
 * la prueba, y `instanceof Error` da `false`: solo un servidor real reproduce las dos cosas.
 */
describe("KitPagos against a real HTTP server that fails", () => {
  const TIMEOUT_MS = 300;
  const HTML_BODY = "<html><body><h1>502 Bad Gateway</h1></body></html>";
  const credentials = { publicKey: "pub_test_http", privateKey: "prv_test_http" };
  const gateways = [Gateway.WOMPI, Gateway.MERCADOPAGO, Gateway.RAPYD, Gateway.KUSHKI];

  let server: http.Server;
  let origin: string;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "";
      if (url.startsWith("/html502")) {
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end(HTML_BODY);
      } else if (url.startsWith("/stall502")) {
        // Cabeceras y parte del cuerpo, y la conexión queda abierta: el corte llega a mitad
        // de la lectura del cuerpo de error, no durante la espera de la respuesta.
        res.writeHead(502, { "Content-Type": "application/json" });
        res.write('{"error": "partial');
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(HTML_BODY);
      }
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  function sdkFor(gateway: Gateway, baseUrl: string): KitPagos {
    return new KitPagos({
      gateway,
      credentials: { [gateway]: credentials },
      baseUrl,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
    });
  }

  async function failureOf(sdk: KitPagos): Promise<KitPagosError> {
    const error = await sdk.getPaymentStatus("tx-http-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KitPagosError);
    return error as KitPagosError;
  }

  it.each(gateways)(
    "%s: a 502 with an HTML body ends in GATEWAY_SERVER_ERROR with the text as originalPayload",
    async (gateway) => {
      const error = await failureOf(sdkFor(gateway, `${origin}/html502`));

      expect(error.code).toBe(KitPagosErrorCode.GATEWAY_SERVER_ERROR);
      expect(error.gateway).toBe(gateway);
      expect(error.originalPayload).toBe(HTML_BODY);
    },
  );

  it.each(gateways)(
    "%s: an error body that stalls past timeoutMs ends in GATEWAY_TIMEOUT",
    async (gateway) => {
      const started = Date.now();
      const error = await failureOf(sdkFor(gateway, `${origin}/stall502`));
      const elapsed = Date.now() - started;

      expect(error.code).toBe(KitPagosErrorCode.GATEWAY_TIMEOUT);
      expect(error.gateway).toBe(gateway);
      // Los temporizadores de Node pueden disparar hasta 1 ms antes por redondeo.
      expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 5);
      expect(elapsed).toBeLessThan(TIMEOUT_MS + 1000);
    },
  );

  it.each(gateways)(
    "%s: a 200 whose body is not JSON ends in MALFORMED_RESPONSE",
    async (gateway) => {
      const error = await failureOf(sdkFor(gateway, `${origin}/ok-html`));

      expect(error.code).toBe(KitPagosErrorCode.MALFORMED_RESPONSE);
    },
  );

  it.each(gateways)(
    "%s: a refused connection ends in CONNECTION_FAILED",
    async (gateway) => {
      const closed = http.createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const port = (closed.address() as AddressInfo).port;
      await new Promise((resolve) => closed.close(resolve));

      const error = await failureOf(sdkFor(gateway, `http://127.0.0.1:${port}`));

      expect(error.code).toBe(KitPagosErrorCode.CONNECTION_FAILED);
    },
  );
});
