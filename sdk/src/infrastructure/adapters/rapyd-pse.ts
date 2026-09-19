import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import { applyReturnUrls } from "./rapyd-payload";
import type { PseBank } from "../../domain/value-objects/PseBank";

/**
 * PSE en Rapyd Collect. Todo lo específico de PSE vive acá y no en el adaptador,
 * por la misma razón que `wompi-pse.ts` y `mercadopago-pse.ts`: son funciones sin
 * estado, se prueban sin montar una petición HTTP y no le cuestan CBO a ninguna
 * clase (`architecture-log.md`, punto 34).
 *
 * ## Lo que se midió contra el sandbox antes de escribir esto
 *
 * Medido el 18 de septiembre de 2026 con las credenciales de `.env`, siguiendo la
 * regla que los puntos 43, 45 y 46 dejaron: la documentación no alcanza.
 *
 * 1. **Son dos llamadas y no hay forma de evitarlo.** Un `POST /v1/payments` con
 *    el `payment_method` completo y sin `customer` previo devuelve
 *    `MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]`. Confirma lo que el
 *    issue #68 había documentado, esta vez con la respuesta en la mano.
 * 2. **`GET /v1/payment_methods/required_fields/{tipo}` miente por omisión.**
 *    Declara solo `customer_identification_type` y
 *    `customer_identification_number`, pero el pago rechaza además por
 *    `[PHONE_NUMBER]` y por `[EMAIL]`, que ese endpoint no menciona. Y el propio
 *    mensaje de error de Rapyd recomienda consultarlo ("Corrective action: Run
 *    'Get Payment Method Required Fields'"), o sea que remite a una lista
 *    incompleta.
 * 3. **El teléfono va en el `customer`, no en los `fields` del pago.** Mandarlo
 *    en `payment_method.fields` devuelve `UNKNOWN_PAYMENT_METHOD_FIELD -
 *    [PHONE_NUMBER]`: el mismo campo que falta en un lado se rechaza en el otro.
 * 4. **El prefijo internacional no hace falta.** `+573001234567` y `3001234567`
 *    funcionan igual, así que el adaptador manda `payer.phone` tal como viene. No
 *    hay transformación que inventar, que es la clase de suposición que el punto
 *    16 registra como defecto.
 * 5. **La redirección viene en la respuesta de creación.** `status: "ACT"`,
 *    `next_action: "pending_confirmation"` y `redirect_url` presente, sin sondeo,
 *    a diferencia de Wompi (punto 43). El `next_action` es un valor que no estaba
 *    en el catálogo conocido cuando el issue #64 decidió detectar la redirección
 *    por la presencia de `redirect_url` en vez de por ese enum: la decisión quedó
 *    validada, porque PSE entró sin tocar `rapyd-redirect.ts`.
 * 6. **Un banco inexistente falla claro**, con
 *    `ERROR_GET_PAYMENT_METHOD_TYPE`, así que no hace falta que el SDK mantenga
 *    la lista de los 47 bancos para validar.
 */

/**
 * Prefijo de los 47 `payment_method_type` de PSE en Rapyd.
 *
 * En Rapyd PSE no es un método con un campo de banco: es una familia de 47 tipos,
 * uno por entidad, con el patrón `co_pse_{banco}_bank` (issue #68, punto 19). Por
 * eso `PaymentMethod.pse({ bankCode })` recibe acá el tipo completo —
 * `co_pse_bancolombia_bank`— y no un número: el `bankCode` es opaco y con
 * significado por pasarela, justamente para que cada una reciba lo que entiende.
 */
const RAPYD_PSE_TYPE_PREFIX = "co_pse_";

/**
 * Falla, antes de tocar la red, si falta algo que Rapyd va a exigir.
 *
 * ## Por qué esta validación local no es redundante
 *
 * Porque el flujo son dos llamadas y **los rechazos no llegan en la llamada que
 * uno esperaría**. Medido: si falta el email, `POST /v1/customers` responde 200 y
 * el error aparece recién en el pago, como
 * `MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [EMAIL]`. O sea que el customer ya
 * quedó creado en Rapyd por un dato que se podía verificar sin salir del proceso,
 * y queda **huérfano**: un cliente sin ningún pago asociado, que el SDK no puede
 * limpiar porque no sabe si el comercio lo quería reutilizar.
 *
 * Validar acá convierte ese estado a medias en un error que ocurre antes de la
 * primera llamada. No lo elimina —una caída de red entre las dos llamadas sigue
 * pudiendo dejarlo— pero saca del camino la causa prevenible.
 *
 * ## Por qué acumula en vez de fallar en el primero
 *
 * Porque PSE en Rapyd pide más datos que tarjeta y que PSE en las otras
 * pasarelas, y un comercio que está integrando merece la lista completa en un
 * intento y no cuatro ciclos de prueba y error. Es lo mismo que hace
 * `mercadopago-pse.ts`.
 */
export function assertPseRequirements(request: CreatePaymentRequest): void {
  const missing: string[] = [];
  const { payer } = request;

  // Rechazado con INVALID_CUSTOMER_NAME si falta. Se usa `fullName` y no
  // firstName/lastName porque Rapyd recibe el nombre en un solo campo.
  if (!payer.fullName) {
    missing.push("payer.fullName");
  }
  // Rechazado como [PHONE_NUMBER] en el pago, no al crear el customer.
  if (!payer.phone) {
    missing.push("payer.phone");
  }
  // Estos dos son los únicos que `required_fields` sí declara.
  if (!payer.documentType) {
    missing.push("payer.documentType");
  }
  if (!payer.documentNumber) {
    missing.push("payer.documentNumber");
  }

  // El código de banco **no** se verifica por ausencia, y no es un olvido:
  // `PaymentMethod.pse()` ya rechaza construirse sin él, así que un PSE sin banco no
  // puede llegar hasta acá. Comprobarlo otra vez sería una rama inalcanzable, que es
  // lo que el punto 46 registra como defecto en espera de que algo la alcance. Lo que
  // el dominio no puede saber es si el código es **de esta pasarela**, y eso sí se
  // verifica más abajo.
  const bankCode = request.paymentMethod?.bankCode;

  if (missing.length > 0) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.RAPYD,
      null,
      `PSE en Rapyd exige datos que faltan en la solicitud: ${missing.join(", ")}. ` +
        `Rapyd los rechaza en la segunda de sus dos llamadas, cuando el cliente ya ` +
        `quedó creado, así que el SDK los verifica antes de la primera.`,
    );
  }

  // El código de banco se verifica aparte porque el diagnóstico es distinto: no
  // falta un dato, sino que el que hay no es de esta pasarela. El caso probable
  // es un comercio que migró de Wompi o Mercado Pago, donde el código es un
  // número, y no cambió el valor al cambiar de pasarela.
  if (bankCode && !bankCode.startsWith(RAPYD_PSE_TYPE_PREFIX)) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.RAPYD,
      null,
      `"${bankCode}" no es un código de banco de Rapyd. En Rapyd PSE son 47 métodos ` +
        `distintos con el patrón ${RAPYD_PSE_TYPE_PREFIX}{banco}_bank, por ejemplo ` +
        `"co_pse_bancolombia_bank", y no un número como en Wompi o Mercado Pago. ` +
        `La lista se obtiene con getPseBanks().`,
    );
  }
}

/**
 * Arma el cuerpo de la primera llamada, `POST /v1/customers`.
 *
 * Manda lo mínimo que el sandbox aceptó: nombre, correo y teléfono. Se midió que
 * agregarle `payment_method` acá también funciona, y que la dirección es
 * opcional, pero ninguno de los dos cambia el resultado, y un campo que no
 * cambia nada es un campo que después hay que explicar.
 */
export function buildCustomerPayload(
  request: CreatePaymentRequest,
): Record<string, unknown> {
  return {
    name: request.payer.fullName,
    email: request.payer.email,
    // Sin normalizar: se midió que Rapyd acepta el número con y sin el prefijo
    // internacional, así que transformarlo sería inventar una regla.
    phone_number: request.payer.phone,
  };
}

/**
 * Arma el cuerpo de la segunda llamada, `POST /v1/payments`.
 *
 * El monto va en pesos y no en centavos, y como string con la escala fija de la
 * divisa, por la misma razón que el camino de tarjeta: Rapyd documenta que
 * `JSON.stringify` convierte `12.00` en `12` y que eso invalida la firma.
 */
export function buildPsePaymentPayload(
  request: CreatePaymentRequest,
  customerId: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    amount: request.amount.toFixedScale(request.currency.getMinorUnitExponent()),
    currency: request.currency.getCode(),
    customer: customerId,
    payment_method: {
      type: request.paymentMethod?.bankCode,
      fields: {
        customer_identification_type: request.payer.documentType,
        customer_identification_number: request.payer.documentNumber,
      },
    },
    merchant_reference_id: request.orderReference.getValue(),
  };

  // Las dos URL del comercio viajan acá y **sí importan**: se midió que Rapyd las
  // incrusta en la `redirect_url` que devuelve. El armado es el mismo que en el
  // camino de tarjeta, y está compartido en `rapyd-payload.ts`.
  applyReturnUrls(payload, request);

  return payload;
}

/**
 * Saca el identificador del cliente de la respuesta de `POST /v1/customers`.
 *
 * Si Rapyd respondió 200 pero sin identificador, seguir con el pago sería mandar
 * `customer: undefined` y recibir un rechazo confuso de la segunda llamada. Falla
 * acá, donde el diagnóstico todavía apunta al paso que salió mal.
 */
export function extractCustomerId(rawResponse: unknown): string {
  const payload = rawResponse as { data?: { id?: unknown } } | null;
  const id = payload?.data?.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      Gateway.RAPYD,
      null,
      "Rapyd aceptó la creación del cliente pero no devolvió su identificador, " +
        "que es obligatorio para el pago por PSE.",
    );
  }

  return id;
}

/**
 * Traduce el catálogo de métodos de pago de Colombia a la lista de bancos.
 *
 * ## Por qué esto es un filtro y no una lectura
 *
 * Porque Rapyd es la única de las cuatro que **no tiene** una lista de bancos: su
 * `GET /v1/payment_methods/country?country=CO` devuelve el catálogo entero del
 * país, y PSE aparece ahí como 47 métodos separados, uno por entidad. Medido el 18
 * de septiembre de 2026: 97 métodos para Colombia, de los cuales 47 empiezan con
 * `co_pse_`, todos con `category: "bank_redirect"` y con el nombre del banco en
 * `name` ("Bancolombia", "Banco Davivienda").
 *
 * El `code` que sale de acá es el `type` completo, que es exactamente lo que
 * `PaymentMethod.pse({ bankCode })` necesita para esta pasarela. Por eso la
 * decisión del punto 19 —que el código de banco sea opaco— es la que hace que
 * Rapyd entre en la misma abstracción que las otras tres sin un caso especial: el
 * comercio nunca mira el valor, solo lo devuelve.
 */
export function parseRapydPseBanks(rawResponse: unknown): PseBank[] {
  const payload = rawResponse as { data?: unknown } | null;
  const methods = Array.isArray(payload?.data) ? payload!.data : [];

  return methods.flatMap((entry) => {
    const method = entry as Record<string, unknown>;
    const type = method.type;

    if (typeof type !== "string" || !type.startsWith(RAPYD_PSE_TYPE_PREFIX)) {
      return [];
    }

    const name = method.name;
    return [{ code: type, name: typeof name === "string" ? name : type }];
  });
}
