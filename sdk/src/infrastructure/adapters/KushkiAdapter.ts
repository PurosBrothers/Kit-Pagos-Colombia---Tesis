import {
  PaymentGatewayPort,
  CreatePaymentRequest,
} from "../../application/ports/PaymentGatewayPort";
import { Transaction } from "../../domain/entities/Transaction";
import {
  PaymentResult,
  transactionResult,
  redirectRequired,
} from "../../domain/value-objects/PaymentResult";
import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { ResponseNormalizer } from "../../application/services/ResponseNormalizer";
import { WebhookVerifier } from "../../domain/services/WebhookVerifier";
import { ErrorHandler } from "../../application/services/ErrorHandler";
import { assertSupportedPaymentMethod } from "./payment-method-support";
import { resolveTaxBreakdown } from "./kushki-amount";
import { CARD_CHARGE_PATH, buildCardChargePayload } from "./kushki-charge";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import type { PseBank } from "../../domain/value-objects/PseBank";
import {
  assertPseRequirements,
  buildTransferTokenPayload,
  buildTransferInitPayload,
  extractTransferToken,
  extractTransferRedirect,
  parseKushkiPseBanks,
  kushkiStatusPaths,
} from "./kushki-pse";

/**
 * Raíz de la API de Kushki (o de su mock en simulator-api).
 *
 * **Cambió con PSE, y es un cambio incompatible.** Antes apuntaba directo a la
 * colección de cobros (`.../kushki/charges`), porque el adaptador solo hablaba con
 * ese recurso. Transfer In obliga a hablar con tres rutas más
 * (`/transfer/v1/bankList`, `/transfer/v1/tokens`, `/transfer/v1/init`), y una URL
 * que apunta a un recurso concreto no deja alcanzarlas sin recortar la cadena.
 *
 * Es el mismo cambio que hicieron los adaptadores de Mercado Pago (punto 45) y
 * Rapyd, y deja a los cuatro con la misma convención: `baseUrl` es la raíz y cada
 * método arma su ruta. Contra la API real de pruebas el valor equivalente es
 * `https://api-uat.kushkipagos.com`.
 */
const DEFAULT_KUSHKI_BASE_URL = "http://localhost:3000/v1/sim/kushki";

/**
 * Las dos credenciales de Kushki no son intercambiables y cada ruta pide una.
 *
 * `Public-Merchant-Id` identifica al comercio en las operaciones que en una
 * integración real ocurren del lado del navegador —pedir la lista de bancos,
 * tokenizar— y `Private-Merchant-Id` en las que cobran. Mandar la privada donde va
 * la pública funciona pero expone la credencial de cobro, así que el adaptador
 * elige explícitamente en cada llamada en vez de mandar siempre la misma.
 */
type KushkiAuth = "public" | "private";

export class KushkiAdapter implements PaymentGatewayPort {
  private readonly baseUrl: string;
  private readonly credentials?: Credentials;
  /** Ver la nota de WompiAdapter: fuera del constructor para no inflar el CBO. */
  private readonly normalizer = new ResponseNormalizer();
  private readonly webhookVerifier: WebhookVerifier;

  constructor(
    baseUrl: string = DEFAULT_KUSHKI_BASE_URL,
    credentials?: Credentials,
    webhookVerifier: WebhookVerifier = new WebhookVerifier(),
  ) {
    this.baseUrl = baseUrl;
    this.credentials = credentials;
    this.webhookVerifier = webhookVerifier;
  }

  /**
   * Devuelve PaymentResult en vez de Transaction desde el issue #64.
   *
   * El cobro con tarjeta de Kushki es síncrono —el resultado viene en la respuesta
   * del POST y no hay estado intermedio—, así que ese camino siempre toma la rama
   * TRANSACTION. La rama de redirección le corresponde a Transfer In, que es el PSE
   * de Kushki.
   */
  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    assertSupportedPaymentMethod(request.paymentMethod, Gateway.KUSHKI, [
      "CARD",
      "PSE",
    ]);

    if (request.paymentMethod?.type === "PSE") {
      return this.createTransferPayment(request);
    }

    const rawResponse = await this.request(
      CARD_CHARGE_PATH,
      "POST",
      "private",
      buildCardChargePayload(request),
    );

    return transactionResult(
      this.normalizer.normalize(rawResponse, Gateway.KUSHKI),
    );
  }

  /**
   * Cobra por PSE, que en Kushki es Transfer In y son **dos llamadas** acá más
   * una que el comercio hizo antes.
   *
   * La secuencia completa que la referencia de Kushki describe son tres pasos, y el
   * primero —pedir la lista de bancos— no está acá porque no puede estar: el
   * pagador tiene que **elegir** de esa lista, y elegir pasa en la interfaz del
   * comercio, no dentro de una llamada a `createPayment()`. Por eso `getPseBanks()`
   * es un método aparte del puerto y no un paso interno: es el único de los tres que
   * necesita una decisión humana en el medio.
   *
   * Los dos que sí quedan escondidos acá son el token y el inicio, por la misma
   * razón que en Rapyd: cuántas llamadas hacen falta es un detalle del proveedor.
   * Y con el mismo costo, que conviene nombrar: si el inicio falla, el token ya
   * quedó emitido. Es menos grave que el cliente huérfano de Rapyd, porque un token
   * sin usar expira solo, pero es el mismo tipo de estado a medias.
   */
  private async createTransferPayment(
    request: CreatePaymentRequest,
  ): Promise<PaymentResult> {
    assertPseRequirements(request);

    const taxBreakdown = resolveTaxBreakdown(request);

    const tokenResponse = await this.request(
      "/transfer/v1/tokens",
      "POST",
      "public",
      buildTransferTokenPayload(request, taxBreakdown),
    );
    const token = extractTransferToken(tokenResponse);

    // El monto se repite acá porque Kushki lo exige en los dos pasos: con solo el
    // token, `init` responde 400. Medido contra la API UAT (punto 48).
    const initResponse = await this.request(
      "/transfer/v1/init",
      "POST",
      "private",
      buildTransferInitPayload(token, taxBreakdown, request.currency.getCode()),
    );

    return redirectRequired(extractTransferRedirect(initResponse, token));
  }

  /**
   * Consulta el estado de un cobro, probando las rutas de Kushki en orden.
   *
   * Kushki no unifica la consulta ni publica un discriminador entre el token de
   * transferencia y el ticket de tarjeta, así que el adaptador prueba las rutas en
   * orden y pasa a la siguiente solo cuando la pasarela responde que no sabe de ese
   * identificador. Por qué la de transferencia va primero está en
   * `kushkiStatusPaths()`, y es una conclusión de medir, no de suponer.
   *
   * "No sabe de ese identificador" son dos respuestas, no una: `404`, que es lo que
   * responde el simulador, y `400` con `T001`, que es lo que responde la API real de
   * Kushki cuando el token no le pertenece a esa ruta. Las dos significan lo mismo
   * para esta decisión.
   *
   * Cualquier otro error corta el intento en vez de seguir probando: un 401 o un 500
   * en la primera ruta no dice nada sobre la segunda, y reintentar ahí convertiría un
   * problema de credenciales en un "no encontrado" que manda a buscar al lugar
   * equivocado.
   */
  async getStatus(gatewayTransactionId: string): Promise<Transaction> {
    const paths = kushkiStatusPaths(gatewayTransactionId);
    let lastError: unknown;

    for (const path of paths) {
      try {
        const rawResponse = await this.request(path, "GET", "private");
        return this.normalizer.normalize(rawResponse, Gateway.KUSHKI);
      } catch (error) {
        if (!isUnknownToRoute(error)) {
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError;
  }

  /**
   * Lista los bancos habilitados para PSE.
   *
   * En Kushki este método no es una comodidad sino un paso obligatorio del cobro:
   * su referencia dice que el endpoint *"is required only for Transfer In payment
   * method in Colombia"*, o sea que el `bankId` tiene que venir de acá. Es la
   * pasarela que mejor justifica que la lista de bancos esté en el puerto.
   */
  async getPseBanks(): Promise<PseBank[]> {
    const rawResponse = await this.request(
      "/transfer/v1/bankList",
      "GET",
      "public",
    );
    return parseKushkiPseBanks(rawResponse);
  }

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean {
    return this.webhookVerifier.verify(
      payload,
      headers,
      secret,
      Gateway.KUSHKI,
    );
  }


  /**
   * Manda una petición y devuelve el cuerpo crudo.
   *
   * Consolidada al implementar PSE. Antes estaba duplicada entre `createPayment` y
   * `getStatus`, casi idéntica, y con Transfer In habrían quedado cinco copias del
   * mismo bloque de treinta líneas: la misma razón por la que el adaptador de Wompi
   * la consolidó en el issue #64.
   */
  private async request(
    path: string,
    method: "GET" | "POST",
    auth: KushkiAuth,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.credentials) {
      // La API de simulación no valida credenciales, así que el adaptador sigue
      // siendo usable sin configuración en pruebas.
      if (auth === "public") {
        headers["Public-Merchant-Id"] = this.credentials.publicKey;
      } else {
        headers["Private-Merchant-Id"] = this.credentials.privateKey;
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch (networkError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(networkError, Gateway.KUSHKI);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(
        { status: response.status, body: errorBody },
        Gateway.KUSHKI,
      );
    }

    try {
      return await response.json();
    } catch (parseError) {
      const errorHandler = new ErrorHandler();
      throw errorHandler.handle(parseError, Gateway.KUSHKI);
    }
  }
}

/**
 * Distingue "esta ruta no sabe de ese identificador" de cualquier otro fallo.
 *
 * Acepta dos códigos porque Kushki y el simulador contestan distinto lo mismo: la
 * API real responde `400` (`T001`, "cuerpo de la petición inválido") cuando el
 * identificador no es de esa ruta, y el simulador responde `404`. Medido contra la
 * API UAT el 18 de septiembre de 2026; antes solo se aceptaba `404`, así que contra
 * Kushki real el respaldo no se activaba nunca.
 *
 * Deliberadamente **no** incluye `INVALID_CREDENTIALS`: un 401 o un 403 puede ser
 * una llave mal configurada, y seguir probando rutas convertiría ese problema en un
 * "no encontrado" que manda a buscar al lugar equivocado.
 *
 * Es una función de módulo y no un método privado porque no usa nada de la
 * instancia, y así no le suma complejidad ponderada a la clase (WMC), que es la
 * métrica que el umbral de la Definition of Done vigila.
 */
function isUnknownToRoute(error: unknown): boolean {
  return (
    error instanceof KitPagosError &&
    (error.code === KitPagosErrorCode.RESOURCE_NOT_FOUND ||
      error.code === KitPagosErrorCode.INVALID_REQUEST)
  );
}
