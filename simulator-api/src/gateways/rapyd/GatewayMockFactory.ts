import { randomBytes } from "node:crypto";
import {
  RapydCreatePaymentRequestBody,
  RapydPayment,
  RapydPaymentResponse,
} from "./types";

/**
 * Gateway Mock Factory — Rapyd (issue #52).
 *
 * Responsabilidad unica: construir el payload que replica la estructura nativa
 * de Rapyd para un escenario dado. No conoce headers ni valida el cuerpo de la
 * peticion; eso es del router. Es el mismo reparto de responsabilidades que en
 * la fabrica de Wompi.
 *
 * Alcance de este issue: solo el escenario aprobado, igual que el mock de Wompi
 * en su momento. Los escenarios de rechazo, expiracion, timeout y error de red
 * para las cuatro pasarelas son el issue #65, y agregarlos aca despues no
 * cambia nada de lo que ya existe.
 */
export class GatewayMockFactory {
  /**
   * Rapyd identifica sus pagos con el prefijo `payment_` seguido de 32
   * caracteres hexadecimales. Se replica esa forma en vez de usar `randomUUID()`
   * como el mock de Wompi, porque un identificador con guiones no se parece a
   * los que devuelve Rapyd y el objetivo del mock es que el adaptador se
   * ejercite contra algo indistinguible de la pasarela real.
   */
  private static buildPaymentId(): string {
    return `payment_${randomBytes(16).toString("hex")}`;
  }

  /** Envuelve el objeto de negocio en el sobre `{ status, data }` que Rapyd usa siempre. */
  private static wrap(data: RapydPayment): RapydPaymentResponse {
    return {
      status: {
        error_code: "",
        status: "SUCCESS",
        message: "",
        response_code: "",
        // Rapyd devuelve un UUID de operacion para trazar la llamada de API.
        operation_id: randomBytes(16).toString("hex"),
      },
      data,
    };
  }

  /**
   * Respuesta de un pago aprobado.
   *
   * `status: "CLO"` con `paid: true` es lo que Rapyd devuelve para un pago
   * efectivamente cobrado. Los dos campos van juntos a proposito: `CLO` por si
   * solo no significa aprobado, y el mock no debe permitir que el adaptador
   * pase una prueba leyendo unicamente el estado.
   *
   * El monto y la divisa se reflejan tal como llegaron. Es lo que permite que
   * una prueba verifique que el SDK envio pesos y no centavos: si el adaptador
   * multiplicara por 100, el monto de vuelta seria cien veces mayor.
   */
  buildApprovedResponse(
    requestBody: RapydCreatePaymentRequestBody,
  ): RapydPaymentResponse {
    return GatewayMockFactory.wrap({
      id: GatewayMockFactory.buildPaymentId(),
      status: "CLO",
      paid: true,
      amount: requestBody.amount,
      currency_code: requestBody.currency,
      merchant_reference_id: requestBody.merchant_reference_id,
      receipt_email: requestBody.receipt_email ?? "",
      failure_code: "",
      failure_message: "",
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Respuesta de la consulta de estado de un pago existente.
   *
   * El mock no guarda estado entre peticiones, asi que reconstruye un pago
   * aprobado con el identificador consultado. Alcanza para que el
   * `RapydAdapter` ejercite su ruta de consulta de punta a punta, que es lo que
   * pide este issue. La persistencia en memoria real, que permitiria que la
   * consulta devuelva el pago tal como se creo, es el issue #55.
   */
  buildStatusResponse(paymentId: string): RapydPaymentResponse {
    return GatewayMockFactory.wrap({
      id: paymentId,
      status: "CLO",
      paid: true,
      amount: "0",
      currency_code: "COP",
      merchant_reference_id: "",
      receipt_email: "",
      failure_code: "",
      failure_message: "",
      created_at: Math.floor(Date.now() / 1000),
    });
  }
}
