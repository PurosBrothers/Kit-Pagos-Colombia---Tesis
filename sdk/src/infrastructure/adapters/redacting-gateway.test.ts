import { KitPagos } from "../facade/KitPagos";
import { Gateway } from "../../domain/value-objects/Gateway";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { withCredentialRedaction } from "./redacting-gateway";
import type { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort";

/**
 * Los caminos de error que no pasan por `httpFailure()`, a través de la fachada (punto 87).
 *
 * Las llaves no llevan los prefijos `pub_` ni `prv_` a propósito: esos ya los quita la
 * limpieza por patrones de `ErrorHandler` del `message`, y lo que se prueba aquí es la
 * búsqueda del valor exacto, que es la única que cubre una llave mal pegada.
 */
describe("withCredentialRedaction()", () => {
  const PUBLIC_KEY = "merchant-public-7f3a";
  const PRIVATE_KEY = "merchant-private-9c1e";
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function sdkFor(gateway: Gateway): KitPagos {
    return new KitPagos({
      gateway,
      credentials: { [gateway]: { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY } },
      maxRetries: 0,
    });
  }

  function respondWith(body: string, status = 200): void {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(body, { status, headers: { "Content-Type": "application/json" } }),
    );
  }

  async function failureOf(sdk: KitPagos): Promise<KitPagosError> {
    const error = await sdk.getPaymentStatus("tx-redact-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KitPagosError);
    return error as KitPagosError;
  }

  /** Los errores no se serializan con `JSON.stringify`: se leen su `message` y su `stack`. */
  function exposedText(value: unknown): string {
    if (Object.prototype.toString.call(value) === "[object Error]") {
      const error = value as Error & { cause?: unknown };
      return `${error.message} ${error.stack ?? ""} ${exposedText(error.cause)}`;
    }
    return JSON.stringify(value) ?? "";
  }

  function expectRedacted(error: KitPagosError): void {
    const exposed = [error.message, exposedText(error.originalPayload), exposedText(error.cause)].join(" ");
    expect(exposed).not.toContain(PUBLIC_KEY);
    expect(exposed).not.toContain(PRIVATE_KEY);
    expect(exposed).toContain("[REDACTED]");
  }

  it("should redact a native Rapyd error that arrives with status 200 and no data", async () => {
    respondWith(
      JSON.stringify({
        status: {
          status: "ERROR",
          error_code: "ERROR_GET_PAYMENT",
          message: `The access key ${PUBLIC_KEY} does not match`,
        },
      }),
    );

    const error = await failureOf(sdkFor(Gateway.RAPYD));

    expectRedacted(error);
    expect(error.originalPayload).toMatchObject({ status: { error_code: "ERROR_GET_PAYMENT" } });
  });

  it("should redact a network error whose message carries a configured value", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError(`fetch failed for key ${PRIVATE_KEY}`));

    expectRedacted(await failureOf(sdkFor(Gateway.MERCADOPAGO)));
  });

  it("should keep the HTTP failure redaction through the wrapper", async () => {
    respondWith(JSON.stringify({ message: `Invalid key ${PRIVATE_KEY}` }), 401);

    expectRedacted(await failureOf(sdkFor(Gateway.KUSHKI)));
  });

  describe("on a port called directly", () => {
    const error = new KitPagosError(
      "UNKNOWN_ERROR" as KitPagosError["code"],
      Gateway.WOMPI,
      { echoed: PRIVATE_KEY },
      `failed with ${PRIVATE_KEY}`,
    );
    const credentials = { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY };

    function portThat(behaviour: Partial<PaymentGatewayPort>): PaymentGatewayPort {
      return behaviour as PaymentGatewayPort;
    }

    it("should redact an error thrown synchronously", () => {
      const port = withCredentialRedaction(
        portThat({
          verifySignature: () => {
            throw error;
          },
        }),
        credentials,
      );

      let thrown: unknown;
      try {
        port.verifySignature("{}", {}, "secret");
      } catch (e) {
        thrown = e;
      }
      expectRedacted(thrown as KitPagosError);
    });

    /*
     * El `MALFORMED_RESPONSE` de parseo lleva el `SyntaxError` como `originalPayload` y como
     * `cause`. Con el `fetch` de Node 22, ese error repite solo los primeros 10 caracteres del
     * cuerpo (`"merchant-p"... is not valid JSON`, observado el 7 de octubre de 2026), así que
     * aquí se construye a mano con el valor entero, que es el caso que sí se puede limpiar.
     */
    it("should redact an Error payload and cause, keeping its class", async () => {
      const parseError = new SyntaxError(`Unexpected token in "${PRIVATE_KEY}"`);
      const malformed = new KitPagosError(
        "MALFORMED_RESPONSE" as KitPagosError["code"],
        Gateway.WOMPI,
        parseError,
        "Failed to parse JSON response from Wompi gateway",
        { cause: parseError },
      );
      const port = withCredentialRedaction(
        portThat({ getStatus: () => Promise.reject(malformed) }),
        credentials,
      );

      const thrown = (await port.getStatus("tx").catch((e: unknown) => e)) as KitPagosError;

      expectRedacted(thrown);
      expect(thrown.originalPayload).toBeInstanceOf(SyntaxError);
    });

    it("should pass through values, errors that are not KitPagosError and properties", async () => {
      const foreign = new Error(`raw ${PRIVATE_KEY}`);
      const port = withCredentialRedaction(
        Object.assign(
          portThat({
            verifySignature: () => true,
            getPseBanks: () => Promise.reject(foreign),
          }),
          { label: "not a function" },
        ),
        credentials,
      );

      expect(port.verifySignature("{}", {}, "secret")).toBe(true);
      await expect(port.getPseBanks()).rejects.toBe(foreign);
      expect((port as unknown as { label: string }).label).toBe("not a function");
    });
  });
});
