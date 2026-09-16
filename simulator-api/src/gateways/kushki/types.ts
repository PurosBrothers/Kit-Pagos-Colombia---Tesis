/**
 * Contratos del mock de Kushki (API de Simulación).
 *
 * Representan la estructura nativa que expone la API de Kushki para
 * POST /card/v1/charges. Confirmados contra la documentación pública
 * (docs.kushki.com, api-docs.kushkipagos.com):
 *
 * 1. El monto no viaja como escalar: Kushki exige un objeto `amount`
 *    descompuesto en subtotalIva0, subtotalIva, iva, ice y currency. Es la
 *    única de las cuatro pasarelas del proyecto que lo hace así.
 * 2. El identificador de transacción es `ticketNumber`, no `id` como Wompi
 *    ni `id` numérico como Mercado Pago.
 * 3. El estado se expone en `transaction_status` (o `code` según el
 *    endpoint), con los valores textuales `APPROVAL` / `DECLINED` — una
 *    letra de diferencia con "APPROVED" que rompe un switch copiado de
 *    Wompi sin darse cuenta.
 * 4. INITIALIZED no está confirmado con fuente pública para pagos con
 *    tarjeta (sí para cash/wire transfers); se incluye en el mock porque
 *    el issue lo pide explícitamente como estado intermedio del ciclo de
 *    vida, análogo a PENDING del dominio.
 * 5. El mock responde HTTP 200 incluso cuando la transacción es rechazada;
 *    el mock replica esto a propósito, porque es el comportamiento que
 *    rompe implementaciones ingenuas que deciden éxito solo mirando el
 *    código HTTP.
 */

/** Desglose de impuestos tal como lo exige el objeto `amount` de Kushki. */
export interface KushkiAmount {
  subtotalIva0: number;
  subtotalIva: number;
  iva: number;
  ice: number;
  currency: string;
}

/** Cuerpo de la solicitud para crear un cargo (POST /card/v1/charges). */
export interface KushkiCreateChargeRequestBody {
  token: string;
  amount: KushkiAmount;
  contactDetails?: {
    email?: string;
    firstName?: string;
    lastName?: string;
  };
}

/** Estados nativos de transacción de Kushki para pagos con tarjeta. */
export type KushkiTransactionStatus = "APPROVAL" | "DECLINED" | "INITIALIZED";

/**
 * Respuesta nativa de Kushki para POST /card/v1/charges y para la consulta
 * de estado. La creación y la consulta simulada responden HTTP 200,
 * incluso cuando transaction_status es
 * DECLINED: la decisión de éxito o fallo está en el cuerpo, nunca en el
 * código HTTP.
 */
export interface KushkiChargeResponse {
  ticketNumber: string;
  transaction_status: KushkiTransactionStatus;
  amount: KushkiAmount;
  transactionReference: string;
}
