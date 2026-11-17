import { randomUUID } from "node:crypto";
import { DECLINED_MESSAGE, KushkiCardDecline } from "./testCards";
import {
  KushkiBank,
  KushkiChargeResponse,
  KushkiCreateChargeRequestBody,
  KushkiDeclinedChargeError,
  KushkiTransactionStatus,
  KushkiTransferInitResponse,
  KushkiTransferStatusResponse,
  KushkiTransferTokenRequestBody,
} from "./types";

/**
 * Gateway Mock Factory — Kushki (API de Simulación).
 *
 * Responsabilidad única: construir el payload de respuesta que replica la
 * estructura nativa de Kushki para un escenario dado. No decide qué
 * escenario ejecutar (eso es responsabilidad de la ruta) y no valida el
 * body de la solicitud.
 *
 * A diferencia de Wompi, esta respuesta no colapsa el monto a un escalar en ningún punto
 * del ciclo de vida. Lo que sí hace, y el mock reproduce desde que se midió, es
 * **desarmarlo en campos sueltos dentro de `details`** en vez de devolver el mismo objeto
 * `amount` que llegó: ver `KushkiChargeResponse` en `types.ts`.
 *
 * Desde el issue #153 son tres clases, una por recurso de la API de Kushki: los cobros con
 * tarjeta de `/card/v1/charges`, las transferencias de PSE de `/transfer/v1` y los cuerpos de
 * error nativos. Ver el punto 107 del `architecture-log.md`.
 */

/** Un token de Kushki: 32 hexadecimales, igual en tarjeta y en transferencia. */
function kushkiToken(): string {
  return randomUUID().replace(/-/g, "");
}

export class KushkiChargeMockFactory {
  private buildResponse(
    requestBody: KushkiCreateChargeRequestBody,
    status: KushkiTransactionStatus,
  ): KushkiChargeResponse {
    const amount = requestBody.amount;
    const total =
      amount.subtotalIva0 + amount.subtotalIva + amount.iva + (amount.ice ?? 0);

    return {
      ticketNumber: randomUUID().replace(/-/g, "").slice(0, 18),
      transactionReference: randomUUID(),
      details: {
        transactionStatus: status,
        trackingCode: requestBody.trackingCode,
        subtotalIva0: amount.subtotalIva0,
        subtotalIva: amount.subtotalIva,
        ivaValue: amount.iva,
        iceValue: amount.ice ?? 0,
        currencyCode: amount.currency,
        approvedTransactionAmount: total,
        responseText:
          status === "APPROVAL" ? "Transacción aprobada" : "Transacción declinada",
        contactDetails: requestBody.contactDetails?.email
          ? { email: requestBody.contactDetails.email }
          : undefined,
      },
    };
  }

  /**
   * Respuesta de `POST /card/v1/tokens`, la tokenización en el navegador.
   *
   * Nivel 1 — medido contra `api-uat.kushkipagos.com` el 17 de octubre de 2026
   * (`docs/testing-data/kushki.md`, §1.3): `201 { token }` con 32 hexadecimales.
   */
  buildCardToken(): { token: string } {
    return { token: kushkiToken() };
  }

  buildApprovedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "APPROVAL");
  }

  /**
   * El registro de un cobro rechazado, con la misma forma que uno aprobado y `DECLINED`. Es lo
   * que se guarda para la consulta; lo que responde la creación es `buildDeclinedChargeError()`.
   */
  buildDeclinedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "DECLINED");
  }

  /**
   * El `400` con el que Kushki responde un cobro rechazado (medido el 24 de octubre de 2026,
   * punto 122). Antes el mock lo respondía con `201` y `DECLINED` en el cuerpo, porque se creía
   * que Kushki nunca usaba el status HTTP para un rechazo; la cuenta UAT aprobaba todo y no se
   * había podido observar. El identificador es el del registro guardado, para que la consulta
   * y el disparo de su webhook lo encuentren.
   */
  buildDeclinedChargeError(
    record: KushkiChargeResponse,
    decline: KushkiCardDecline,
  ): KushkiDeclinedChargeError {
    return {
      code: decline.responseCode,
      message: DECLINED_MESSAGE,
      details: {
        ticketNumber: "",
        transactionId: record.ticketNumber,
        responseCode: decline.responseCode,
        responseText: decline.responseText,
        approvedTransactionAmount: 0,
      },
      transactionReference: record.transactionReference,
    };
  }

  buildInitializedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "INITIALIZED");
  }

  /**
   * Construye una respuesta de cobro expirado.
   */
  buildExpiredResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    const response = this.buildResponse(requestBody, "DECLINED");
    response.details.responseText = "Transacción expirada";
    return response;
  }
}

/** Las transferencias de PSE: la lista de bancos, el token, el `init` y el registro guardado. */
export class KushkiTransferMockFactory {
  /**
   * Lista de bancos de `GET /transfer/v1/bankList`.
   *
   * **Los nombres son de bancos colombianos reales pero la lista no es la de
   * Kushki**, porque no se pudo consultar sin credenciales de API. Se eligieron
   * codigos numericos de tres digitos, distintos de los de Wompi y Mercado Pago, a
   * proposito: si el simulador devolviera los mismos codigos que otra pasarela,
   * una prueba de que el codigo de banco no es intercambiable entre pasarelas
   * podria pasar por casualidad.
   */
  buildBankList(): KushkiBank[] {
    return [
      /*
       * El primer elemento no es un banco: es el texto de relleno de un `<select>`
       * viajando dentro de los datos. Está aquí porque **la API real lo devuelve**,
       * medido el 18 de septiembre de 2026, y el mock existe para reproducir lo que
       * la pasarela contesta y no lo que conviene. Sin esta entrada, la prueba de que
       * el SDK lo descarta no probaria nada.
       */
      { code: "0", name: "A continuacion seleccione su banco" },
      { code: "001", name: "Bancolombia" },
      { code: "002", name: "Banco de Bogota" },
      { code: "007", name: "Davivienda" },
      { code: "013", name: "BBVA Colombia" },
    ];
  }

  /**
   * Respuesta de `POST /transfer/v1/tokens`.
   *
   * Kushki devuelve un token de 32 caracteres, que despues es **el identificador
   * de la transaccion**: la consulta de estado es por token, no por un id nuevo.
   */
  buildTransferToken(): { token: string } {
    return { token: kushkiToken() };
  }

  /**
   * Respuesta de `POST /transfer/v1/init`, con los cinco campos medidos.
   *
   * **No trae estado**, y eso es lo medido: la respuesta real son `bankId`,
   * `bankName`, `redirectUrl`, `transactionReference` y `trazabilityCode`. El mock
   * decia antes `status: "INITIALIZED"`, un campo que Kushki no manda y un valor que
   * pertenece al vocabulario de tarjeta.
   *
   * La `redirectUrl` imita la forma real, que apunta a un agente de Kushki con el token en
   * la query: medida el 14 de octubre de 2026 (punto 94), es
   * `https://api-uat.kushkipagos.com/transfer/v1/agent?token=…&mid=…`, y el simulador no agrega
   * el `mid`. A donde lleve despues —portal de PSE o banco directo— depende, segun la
   * documentacion, de si el comercio tiene PSE 1.0 o PSE Avanza 2.0; en UAT llevo a la pagina
   * «Kushki Bank» de `uat-sandbox.kushkipagos.com/checkout/transfer`.
   *
   * `origin` es el `protocolo://host` de la peticion que hace el `init` (`requestOrigin()`):
   * el agente es la pagina de banco del propio simulador, bajo `/v1/sim/kushki`. Antes
   * apuntaba a `sandbox-pse.kushkipagos.com`, un dominio que no resuelve para un token que el
   * simulador invento (issue #109).
   */
  buildTransferInit(token: string, origin: string): KushkiTransferInitResponse {
    return {
      bankId: "001",
      bankName: "Bancolombia",
      redirectUrl: `${origin}/v1/sim/kushki/transfer/v1/agent?token=${token}`,
      transactionReference: randomUUID(),
      trazabilityCode: String(Math.floor(Math.random() * 1_000_000_000)),
    };
  }

  /**
   * El registro de la transferencia en el momento en que se emite el token (issue #124).
   *
   * Antes la transferencia no existía hasta que alguien la consultaba, y esa consulta
   * armaba la respuesta de cero con un `bankId` y un `callbackUrl` de mentira. Tres
   * cosas se rompían a la vez:
   *
   * - El comercio que mandaba `bankId: "007"` recibía un `001` al consultar.
   * - El `callbackUrl` que él había registrado nunca volvía, así que la conciliación
   *   por referencia no tenía contra qué compararse.
   * - El monto era fijo, y un cobro de 20.000 pesos se reportaba como de 150.000.
   *
   * La transferencia nace aquí, cuando se emite el token, y de ahí en adelante la
   * consulta responde el registro guardado en vez de fabricar uno. Es el mismo cambio
   * que en las otras tres pasarelas: **lo que se guardó es lo que se devuelve.**
   *
   * Los campos que envió el comercio al pedir el token vuelven tal cual en la consulta.
   * Nivel 1 para la referencia: la consulta medida contra Kushki UAT devuelve
   * `paymentDescription` con la referencia del comercio intacta
   * (`docs/testing-data/kushki.md`, sección del Transfer In, «La consulta de estado
   * devuelve otra forma»). `email`, `amount`, `bankId`, `documentType`, `documentNumber`
   * y `callbackUrl` aparecen en esa misma respuesta, pero el registro no dice si repiten
   * la petición: que vuelvan tal cual es una decisión del simulador, de nivel 3. Antes la
   * semilla fijaba `ORDER-SIM-PSE` y un correo de relleno, así que el SDK devolvía siempre
   * la misma referencia y la conciliación no tenía contra qué compararse.
   *
   * Los valores fijos son solo el relleno de un campo que la petición no trajo; el resto
   * (`country`, `merchantName`, `transactionReference`) lo genera Kushki y no lo controla
   * el comercio.
   *
   * Es también la forma de `GET /transfer/v1/status/{token}`: la consulta devuelve este
   * registro con su estado movido por la máquina, y la respuesta real **no** trae
   * `ticketNumber` ni `transaction_status` ni `contactDetails`, trae `token`, `status` y
   * `email` en la raíz (punto 48).
   */
  buildTransferSeed(
    token: string,
    request: KushkiTransferTokenRequestBody,
  ): KushkiTransferStatusResponse {
    return {
      status: "requestedToken",
      token,
      paymentDescription: request.paymentDescription ?? "ORDER-SIM-PSE",
      email: request.email ?? "comprador@example.com",
      amount: request.amount ?? {
        subtotalIva0: 150000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      },
      transactionReference: randomUUID(),
      bankId: request.bankId ?? "001",
      documentType: request.documentType ?? "CC",
      documentNumber: request.documentNumber ?? "1999888777",
      currency: request.currency ?? "COP",
      country: "Colombia",
      created: Date.now(),
      merchantName: "KIT PAGOS COLOMBIA",
      callbackUrl: request.callbackUrl ?? "https://comercio.example.com/retorno",
    };
  }
}

/** Los cuerpos de error nativos de Kushki, los que usa `technicalFailure()` en todas sus rutas. */
export class KushkiErrorMockFactory {
  /**
   * Respuesta nativa de timeout para Kushki (HTTP 504).
   */
  buildTimeoutResponse() {
    return {
      code: "K504",
      message: "Gateway Timeout en Kushki",
    };
  }

  /**
   * Respuesta nativa de rate limit para Kushki (HTTP 429).
   */
  buildRateLimitResponse() {
    return {
      code: "K429",
      message: "Demasiadas peticiones a Kushki (Rate limit exceeded)",
    };
  }

  /**
   * Respuesta nativa de error de servidor para Kushki (HTTP 5xx).
   */
  buildServerErrorResponse(status = 500) {
    return {
      code: `K${status}`,
      message: `Error interno de servidor en Kushki (${status})`,
    };
  }
}
