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

/** Cuerpo de la solicitud para crear una transacción, con la forma real de Wompi. */
export interface WompiCreateTransactionRequestBody {
  amount_in_cents: number;
  currency: string;
  reference: string;
  customer_email: string;
  payment_method: Record<string, unknown>;
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
}

/** Envoltorio de respuesta real de Wompi: el objeto de negocio siempre viaja dentro de `data`. */
export interface WompiTransactionResponse {
  data: WompiTransaction;
}