import { Transaction } from "../../domain/entities/Transaction";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { ReturnUrlConfig } from "../../domain/value-objects/ReturnUrlConfig";
import { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import { PaymentResult } from "../../domain/value-objects/PaymentResult";
import { PseBank } from "../../domain/value-objects/PseBank";

/**
 * Datos de entrada para crear un pago a traves de un Adapter concreto.
 * No especificado literalmente por el SAD; se construye a partir de los
 * mismos objetos de valor que componen la entidad Transaction (seccion 15.1)
 * para mantener consistencia con el resto del modelo de dominio.
 */
export interface CreatePaymentRequest {
  amount: Amount;
  currency: Currency;
  orderReference: OrderReference;
  payer: Payer;
  returnUrlConfig?: ReturnUrlConfig;
  /**
   * Descomposicion del monto en base gravable e impuestos. Opcional porque solo
   * Kushki exige el monto descompuesto; las otras tres pasarelas reciben un
   * escalar y lo ignoran.
   *
   * Cuando no se informa, el KushkiAdapter asume el caso exento
   * (`TaxBreakdown.exempt`), que es lo que documenta el lenguaje ubicuo: todo el
   * monto va a `subtotalIva0` y el resto de componentes en cero. Inventar un IVA
   * que el comercio no declaro seria peor que no descomponer.
   *
   * Si se informa, el total del desglose debe coincidir con `amount`; el Adapter
   * que lo consuma es responsable de verificarlo.
   */
  taxBreakdown?: TaxBreakdown;

  /**
   * Con qué se paga. Opcional: cuando se omite, cada pasarela aplica su método
   * por defecto, que en las cuatro es tarjeta. Se dejó opcional a propósito para
   * que el contrato anterior siga siendo válido — un pago con tarjeta no tiene
   * por qué declarar que es con tarjeta.
   *
   * Cuando `paymentMethod.requiresPayerDocument()` es verdadero, `payer` debe
   * traer `documentType` y `documentNumber`. Es responsabilidad del adaptador
   * verificarlo antes de la llamada de red: un documento faltante es un error de
   * validación local, no un rechazo de la pasarela, y descubrirlo por un HTTP 400
   * gasta una ida y vuelta para nada.
   */
  paymentMethod?: PaymentMethod;

  /**
   * Dirección IP de quien está pagando, tal como la ve el servidor del comercio.
   *
   * Vive en la solicitud y no en `Payer` porque no es un atributo de la persona
   * sino de la petición concreta: el mismo pagador cambia de IP entre un pago y
   * el siguiente, y guardarla en el objeto de valor invitaría a reutilizar un
   * dato caduco.
   *
   * Mercado Pago la exige para PSE (`additional_info` es obligatorio en la
   * Orders API, medido el 18 de septiembre de 2026). Las otras tres no la piden,
   * y por eso es opcional.
   */
  ipAddress?: string;
}

/**
 * Puerto de salida de la Arquitectura Hexagonal. Contrato que deben
 * implementar los cuatro Adapters de pasarela (WompiAdapter, RapydAdapter,
 * MercadoPagoAdapter, KushkiAdapter).
 * Fuente: SAD, seccion 15.2 (SDK) - "Los cuatro Adapters [...] implementan
 * la interfaz PaymentGatewayPort, que define los metodos createPayment(),
 * getStatus() y verifySignature()."
 */
export interface PaymentGatewayPort {
  /**
   * Crea un pago.
   *
   * Devuelve `PaymentResult` y no `Transaction` desde el issue #64: hay métodos
   * de pago que no terminan en la respuesta, sino que exigen mandar al pagador a
   * una URL (PSE, 3DS, checkout hospedado). La unión obliga al llamante a
   * distinguir los dos casos; con un campo opcional en `Transaction`, olvidar la
   * redirección compilaba igual.
   */
  createPayment(request: CreatePaymentRequest): Promise<PaymentResult>;

  getStatus(gatewayTransactionId: string): Promise<Transaction>;

  /**
   * Lista las entidades financieras habilitadas para cobrar por PSE.
   *
   * ## Por qué el puerto crece, que no es gratis
   *
   * El puerto es el contrato que sostiene el argumento de este trabajo, así que
   * agregarle un método obliga a justificarlo: las cuatro pasarelas tienen que
   * implementarlo, y cada método nuevo es una promesa más que las cuatro deben
   * poder cumplir. Se agregó porque elegir banco **no es un paso opcional de
   * PSE, es parte del método de pago**: sin la lista, el comercio no puede
   * construir la pantalla que PSE exige, y termina hablándole directo a la
   * pasarela justo antes de usar el SDK para cobrar. Un puerto que cubre el cobro
   * pero no el paso sin el cual el cobro no puede armarse deja la abstracción
   * incompleta en el peor lugar posible, que es el visible.
   *
   * La alternativa considerada era una interfaz aparte que implementaran solo los
   * adaptadores con PSE. Se descartó porque las cuatro pasarelas soportan PSE de
   * forma nativa, así que la interfaz aparte no ahorraba ninguna implementación y
   * en cambio obligaba al comercio a preguntarle al SDK si su pasarela sabe
   * responder, que es exactamente el tipo de pregunta que el SDK existe para no
   * tener que hacer.
   *
   * ## Lo que este método no hace
   *
   * No cachea. La lista no cambia entre dos pagos y pedirla en cada carga del
   * checkout gasta una llamada, pero guardarla dentro del SDK sería el primer
   * estado que tendrían los adaptadores, y con estado aparece la pregunta de
   * cuándo se invalida —que es justamente el caso que importa, una entidad
   * caída—. El comercio, que sabe cuánto tolera de desactualización en su propio
   * checkout, puede cachear; el SDK no puede saberlo por él.
   */
  getPseBanks(): Promise<PseBank[]>;

  verifySignature(
    payload: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean;
}
