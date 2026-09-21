import { randomUUID } from "node:crypto";
import {
  KushkiBank,
  KushkiChargeResponse,
  KushkiCreateChargeRequestBody,
  KushkiTransactionStatus,
  KushkiTransferInitResponse,
  KushkiTransferStatus,
  KushkiTransferStatusResponse,
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
 */
export class GatewayMockFactory {
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

  buildApprovedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "APPROVAL");
  }

  /**
   * Construye una respuesta de rechazo. Deliberadamente con el mismo shape
   * y el mismo código HTTP que una aprobada: es el escenario que da valor
   * a la prueba, porque un adaptador que decide éxito mirando el status
   * HTTP en vez del cuerpo va a reportar este rechazo como aprobado.
   */
  buildDeclinedResponse(
    requestBody: KushkiCreateChargeRequestBody,
  ): KushkiChargeResponse {
    return this.buildResponse(requestBody, "DECLINED");
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
       * viajando dentro de los datos. Esta aca porque **la API real lo devuelve**,
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
    return { token: randomUUID().replace(/-/g, "") };
  }

  /**
   * Respuesta de `POST /transfer/v1/init`, con los cinco campos medidos.
   *
   * **No trae estado**, y eso es lo medido: la respuesta real son `bankId`,
   * `bankName`, `redirectUrl`, `transactionReference` y `trazabilityCode`. El mock
   * decia antes `status: "INITIALIZED"`, un campo que Kushki no manda y un valor que
   * pertenece al vocabulario de tarjeta.
   *
   * La `redirectUrl` imita la real, que apunta a un agente de Kushki con el token en
   * la query. A donde lleve despues —portal de PSE o banco directo— depende de si el
   * comercio tiene PSE 1.0 o PSE Avanza 2.0.
   */
  buildTransferInit(token: string): KushkiTransferInitResponse {
    return {
      bankId: "001",
      bankName: "Bancolombia",
      redirectUrl: `https://sandbox-pse.kushkipagos.com/transfer/v1/agent?token=${token}`,
      transactionReference: randomUUID(),
      trazabilityCode: String(Math.floor(Math.random() * 1_000_000_000)),
    };
  }

  /**
   * Respuesta de `GET /transfer/v1/status/{token}`, con la forma medida.
   *
   * Antes reusaba la forma de un cobro con tarjeta, con el token metido en
   * `ticketNumber`, "para que el normalizador la entienda sin ramas nuevas". Era al
   * reves de como tiene que ser: la respuesta real **no** trae `ticketNumber` ni
   * `transaction_status` ni `contactDetails`, trae `token`, `status` y `email` en la
   * raiz. El mock que se acomoda al codigo confirma el codigo en vez de verificarlo,
   * y eso es justo lo que escondio el defecto (punto 48).
   */
  buildTransferStatus(
    token: string,
    status: KushkiTransferStatus,
  ): KushkiTransferStatusResponse {
    return {
      status,
      token,
      paymentDescription: "ORDER-SIM-PSE",
      email: "comprador@example.com",
      amount: {
        subtotalIva0: 150000,
        subtotalIva: 0,
        iva: 0,
        ice: 0,
        currency: "COP",
      },
      transactionReference: randomUUID(),
      bankId: "001",
      documentType: "CC",
      documentNumber: "1999888777",
      currency: "COP",
      country: "Colombia",
      created: Date.now(),
      merchantName: "KIT PAGOS COLOMBIA",
      callbackUrl: "https://comercio.example.com/retorno",
    };
  }
}
