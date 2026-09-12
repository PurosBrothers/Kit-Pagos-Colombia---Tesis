/**
 * Contratos del mock de Rapyd (issue #52).
 *
 * Replican, de forma reducida, la estructura real que expone Rapyd Collect
 * (`POST /v1/payments` y `GET /v1/payments/{id}`) segun
 * `docs.rapyd.net/en/create-payment.html`. Igual que en el mock de Wompi, el
 * alcance es minimo: solo los campos que el `RapydAdapter` del SDK necesita
 * para normalizar la respuesta. Ampliarlos despues no rompe nada, porque el
 * adaptador lee campos por nombre y no posicionalmente.
 *
 * Dos diferencias de forma frente a Wompi que conviene tener presentes, porque
 * son fuente habitual de errores al copiar el mock de una pasarela a otra:
 *
 * 1. Rapyd envuelve **todas** sus respuestas en `{ status, data }`, donde
 *    `status` es el resultado de la operacion de API (no el del pago) y `data`
 *    es el objeto de negocio. Wompi solo usa `data`.
 * 2. La divisa entra como `currency` en la peticion y sale como
 *    `currency_code` en la respuesta. No es un error de transcripcion: son
 *    nombres distintos en el contrato real.
 */

/**
 * Estados nativos de un pago de Rapyd, tal como los lista la documentacion del
 * campo `status` en `create-payment.html`.
 *
 * `REV` estaba pendiente de confirmar en `ubiquitous-language.md`, que
 * conjeturaba `CAN` para el caso de cancelacion. El valor real es `REV`
 * ("Reversed by Rapyd"), con el motivo en `cancel_reason`.
 */
export type RapydPaymentStatus =
  /** Activo: creado y esperando que el pagador lo complete. */
  | "ACT"
  /** Cerrado. Es aprobado solo si ademas `paid` es true. */
  | "CLO"
  /** Error al crear o completar el pago. */
  | "ERR"
  /** Expirado sin completarse. */
  | "EXP"
  /** Revertido por Rapyd. */
  | "REV";

/** Cuerpo de la peticion de creacion de pago, con la forma real de Rapyd. */
export interface RapydCreatePaymentRequestBody {
  /**
   * Monto en la unidad mayor de la divisa (pesos, no centavos).
   *
   * Se acepta `string` ademas de `number` a proposito: la propia documentacion
   * de firma de Rapyd recomienda enviarlo como string numerico cuando tiene
   * ceros a la derecha, porque JSON.stringify convierte `12.00` en `12` y eso
   * cambia el cuerpo sobre el que se calcula la firma. El SDK envia string.
   */
  amount: string | number;
  currency: string;
  merchant_reference_id: string;
  receipt_email?: string;
  complete_payment_url?: string;
  error_payment_url?: string;
  payment_method?: Record<string, unknown>;
}

/** Objeto de negocio que Rapyd retorna dentro de `data`. */
export interface RapydPayment {
  /** Rapyd prefija los identificadores de pago con `payment_`. */
  id: string;
  status: RapydPaymentStatus;
  /** Refleja el monto recibido, en unidad mayor. */
  amount: string | number;
  /** Ojo: en la respuesta es `currency_code`, no `currency`. */
  currency_code: string;
  merchant_reference_id: string;
  /**
   * Discriminante obligatorio para resolver `CLO`: un pago cerrado solo esta
   * aprobado si ademas fue pagado. `CLO` con `paid: false` no es una
   * aprobacion, y tratarlo como tal seria dar por cobrado lo que no se cobro.
   */
  paid: boolean;
  receipt_email: string;
  /** Vacios cuando no hay fallo. Desambiguan `ERR` entre rechazo y error tecnico. */
  failure_code: string;
  failure_message: string;
  created_at: number;
}

/**
 * Envoltorio de respuesta de Rapyd. `status.status` describe el resultado de la
 * llamada de API (`SUCCESS` o `ERROR`), que es independiente del estado del
 * pago que viaja en `data.status`.
 */
export interface RapydPaymentResponse {
  status: {
    error_code: string;
    status: "SUCCESS" | "ERROR";
    message: string;
    response_code: string;
    operation_id: string;
  };
  data: RapydPayment;
}
