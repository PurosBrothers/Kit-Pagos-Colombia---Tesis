/**
 * Contratos del mock de Wompi (alcance mínimo, issue #27).
 *
 * Representan, de forma reducida, la estructura real que expone la API de
 * Wompi para la creación de una transacción. Este alcance mínimo solo
 * cubre los campos necesarios para el escenario APROBADO; la Iteración 3
 * ampliará estos contratos (payment_method detallado, shipping_address,
 * etc.) sin romper este módulo, ya que WompiAdapter (SDK) depende de esta
 * misma forma para normalizar la respuesta.
 */

/**
 * Método de pago tal como Wompi lo devuelve, con el detalle que PSE necesita
 * (issue #64).
 *
 * `extra` es donde Wompi publica la URL de redirección al banco, en
 * `async_payment_url`. No viene en la respuesta de creación: aparece en una
 * consulta posterior, y ese orden es justamente lo que el simulador reproduce.
 */
export interface WompiPaymentMethod {
  type: string;
  user_type?: number;
  user_legal_id?: string;
  user_legal_id_type?: string;
  payment_description?: string;
  financial_institution_code?: string;
  extra?: Record<string, unknown>;
}

/** Cuerpo de la solicitud para crear una transacción, con la forma real de Wompi. */
export interface WompiCreateTransactionRequestBody {
  amount_in_cents: number;
  currency: string;
  reference: string;
  customer_email: string;
  /**
   * Opcional porque Wompi lo es: un pago con tarjeta tokenizada no lo declara y
   * la pasarela aplica su método por defecto. El SDK solo lo envía para PSE.
   */
  payment_method?: WompiPaymentMethod;
  /** Los tres campos de autenticación que Wompi exige y el mock no valida. */
  redirect_url?: string;
  acceptance_token?: string;
  signature?: string;
}

/** Objeto `transaction` que Wompi retorna dentro de `data` al crear una transacción. */
export interface WompiTransaction {
  id: string;
  status: "APPROVED" | "DECLINED" | "PENDING" | "ERROR" | "VOIDED";
  amount_in_cents: number;
  currency: string;
  reference: string;
  /**
   * Wompi devuelve el correo del pagador en la transacción creada. El mock lo
   * refleja porque el SDK lo usa para reconstruir su objeto de valor Payer; si
   * no viniera, el SDK caería a un correo de relleno y la transacción
   * normalizada mostraría un pagador que nunca existió.
   */
  customer_email: string;
  /** Presente solo en los pagos que declaran método, hoy PSE. */
  payment_method?: WompiPaymentMethod;
  /** URL de retorno del comercio, que Wompi refleja tal como se la enviaron. */
  redirect_url?: string;
}

/** Envoltorio de respuesta real de Wompi: el objeto de negocio siempre viaja dentro de `data`. */
export interface WompiTransactionResponse {
  data: WompiTransaction;
}

/**
 * Respuesta de `GET /merchants/:publicKey`.
 *
 * El SDK la necesita por el `acceptance_token`, que Wompi exige en cada
 * creación de transacción y entrega firmado y de un solo uso.
 */
export interface WompiMerchantResponse {
  data: {
    presigned_acceptance: {
      acceptance_token: string;
      permalink: string;
    };
  };
}