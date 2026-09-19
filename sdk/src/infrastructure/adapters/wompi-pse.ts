/**
 * Mecánica de PSE y de autenticación de peticiones salientes de Wompi.
 *
 * ## Por qué está separado del WompiAdapter
 *
 * Por lo mismo que `rapyd-signature.ts` (architecture-log.md, punto 33): son
 * reglas con especificación externa y sin estado, que se pueden probar aisladas
 * sin montar una petición HTTP. Y por presupuesto de complejidad: `createPayment`
 * ya tenía seis pasos numerados, y meterle validación de documento, firma,
 * token de aceptación y sondeo la habría empujado sobre el MAX_CC ≤ 10 de la
 * Definition of Done.
 *
 * ## Qué se verificó contra el sandbox real, y qué salió
 *
 * Todo lo que sigue está medido contra `https://sandbox.wompi.co/v1` el 18 de
 * septiembre de 2026, no leído de la documentación. Cuatro resultados que
 * cambiaron el diseño:
 *
 * 1. **La respuesta de creación de un PSE no trae la URL de redirección.** El
 *    `POST /transactions` devuelve `status: "PENDING"` y un `payment_method.extra`
 *    que solo tiene `{is_three_ds, three_ds_auth_type}`. El campo
 *    `async_payment_url` aparece únicamente en un `GET /transactions/{id}`
 *    posterior. Wompi no es, como se venía asumiendo, un flujo de una sola
 *    llamada antes de redirigir.
 *
 * 2. **En sandbox la URL y el estado final llegan en el mismo instante.** Con el
 *    banco que aprueba, la URL apareció a los 1075 ms junto con `APPROVED`; con
 *    el que declina, a los 1650 ms junto con `DECLINED`. El sandbox resuelve el
 *    pago solo, sin que nadie visite el banco, así que cuando la URL existe ya
 *    no sirve. La consecuencia es que **el sandbox de Wompi no puede validar el
 *    orden del flujo de redirección**: solo la forma del campo. El orden
 *    correcto únicamente se puede ejercitar contra la API de simulación, y esa
 *    es hoy la justificación más fuerte de que el simulador exista.
 *
 * 3. **`financial_institution_code` no se valida al crear.** Un código
 *    inexistente (`"99"`) devolvió HTTP 201. El SDK no puede delegarle a la
 *    pasarela la detección de un banco inválido.
 *
 * 4. **Campos obligatorios, medidos por omisión.** `payment_description`,
 *    `user_type`, `user_legal_id` y `user_legal_id_type` devuelven 422 si
 *    faltan. `redirect_url` y `customer_data` no: aceptan 201 sin ellos, y por
 *    eso `ReturnUrlConfig` sigue siendo opcional para PSE.
 */
import { createHash } from "node:crypto";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";
import { GatewayTransactionId } from "../../domain/value-objects/GatewayTransactionId";
import type { PendingRedirect } from "../../domain/value-objects/PaymentResult";
import type { PayerKind, PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import type { Payer } from "../../domain/value-objects/Payer";
import type { PseBank } from "../../domain/value-objects/PseBank";

/**
 * Tipos de documento que Wompi acepta en `user_legal_id_type`.
 *
 * No es una lista elegida por nosotros: es exactamente la que el sandbox
 * devuelve en el mensaje de validación cuando se omite el campo ("Debe ser uno
 * de estos: RC, TI, CC, TE, CE, NIT, PP, DNI, PPT, PA").
 *
 * Vive acá y no en `Payer` porque es un conjunto con alcance de pasarela.
 * `Payer.documentType` es un string libre a propósito: el mismo pagador puede
 * ser válido para una pasarela e inválido para otra, y meter la lista de Wompi
 * en el dominio le daría a una pasarela poder de veto sobre las otras tres.
 */
export const WOMPI_DOCUMENT_TYPES: readonly string[] = [
  "RC",
  "TI",
  "CC",
  "TE",
  "CE",
  "NIT",
  "PP",
  "DNI",
  "PPT",
  "PA",
];

/** Límite y cadencia del sondeo por la URL de redirección. */
const DEFAULT_REDIRECT_TIMEOUT_MS = 5000;
const DEFAULT_REDIRECT_INTERVAL_MS = 400;

/** Campos nativos que Wompi espera en `payment_method` para un PSE. */
export interface WompiPseFields {
  readonly type: "PSE";
  readonly user_type: 0 | 1;
  readonly user_legal_id_type: string;
  readonly user_legal_id: string;
  readonly financial_institution_code: string;
  readonly payment_description: string;
}

/** Lo que el sondeo necesita mirar en cada consulta. */
export interface WompiRedirectSnapshot {
  readonly status: string;
  readonly redirectUrl?: string;
}

export interface RedirectPollOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** Inyectables para que las pruebas no esperen tiempo real, igual que RetryHandler. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/**
 * Firma de integridad de Wompi.
 *
 * Fórmula: `SHA256(reference + amount_in_cents + currency + integrity_secret)`.
 * Es SHA256 plano, **no** un HMAC, a diferencia de la firma de webhooks que
 * verifica `WebhookVerifier`. Confundir las dos da HTTP 422 con el mensaje "La
 * firma es inválida", que fue exactamente el síntoma que se persiguió mientras
 * los dos secretos del `.env` estaban rotulados al revés.
 *
 * El monto va como entero de centavos y la divisa en mayúsculas, en ese orden;
 * cualquier permutación produce una firma que Wompi rechaza sin decir por qué.
 */
export function computeIntegritySignature(
  reference: string,
  amountInCents: number,
  currency: string,
  integritySecret: string,
): string {
  return createHash("sha256")
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest("hex");
}

/** Wompi codifica la naturaleza jurídica como número; el dominio la nombra. */
function toUserType(payerKind: PayerKind | undefined): 0 | 1 {
  return payerKind === "LEGAL" ? 1 : 0;
}

/**
 * Texto que el pagador va a ver en el banco.
 *
 * Wompi lo exige y el dominio no tiene ese dato, así que se deriva de la
 * referencia del pedido. Se decidió derivarlo en vez de agregar un campo al
 * contrato público para no ampliar la superficie del SDK justo antes de
 * publicarlo en npm (issue #88). La contrapartida, y conviene tenerla escrita:
 * el pagador ve una referencia interna del comercio en lugar de un texto
 * pensado para él. Si eso molesta en la práctica, la salida es un campo
 * `description` opcional en `CreatePaymentRequest`, no tocar esta función.
 */
function toPaymentDescription(orderReference: string): string {
  return `Pago ${orderReference}`;
}

/**
 * Arma los campos nativos de un PSE, validando localmente lo que Wompi
 * rechazaría con un 422.
 *
 * La validación es local a propósito: un documento faltante es un error del
 * comercio, no un rechazo de la pasarela, y descubrirlo por una ida y vuelta
 * HTTP gasta una llamada para nada. Es la misma razón que ya documenta
 * `CreatePaymentRequest.paymentMethod`.
 */
export function buildPseFields(attributes: {
  bankCode: string;
  payerKind?: PayerKind;
  payer: Payer;
  orderReference: string;
}): WompiPseFields {
  const { documentType, documentNumber } = attributes.payer;

  if (!documentType || !documentNumber) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.WOMPI,
      null,
      "PSE requiere documentType y documentNumber en Payer",
    );
  }

  if (!WOMPI_DOCUMENT_TYPES.includes(documentType)) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.WOMPI,
      null,
      `Wompi no acepta el tipo de documento '${documentType}'. ` +
        `Válidos: ${WOMPI_DOCUMENT_TYPES.join(", ")}`,
    );
  }

  return {
    type: "PSE",
    user_type: toUserType(attributes.payerKind),
    user_legal_id_type: documentType,
    user_legal_id: documentNumber,
    financial_institution_code: attributes.bankCode,
    payment_description: toPaymentDescription(attributes.orderReference),
  };
}

/** Datos ya convertidos a formato de cable con los que se arma el cuerpo del POST. */
export interface WompiPayloadAttributes {
  readonly amountInCents: number;
  readonly currency: string;
  readonly reference: string;
  readonly customerEmail: string;
  readonly pseFields?: WompiPseFields;
  readonly redirectUrl?: string;
  readonly acceptanceToken?: string;
  readonly integritySecret?: string;
}

/**
 * Arma el cuerpo de `POST /transactions`.
 *
 * Los tres campos de autenticación se agregan solo si hay con qué: la API de
 * simulación no valida firmas ni token de aceptación, así que el SDK tiene que
 * seguir siendo usable sin credenciales. Contra Wompi real los tres son
 * obligatorios, y su ausencia se manifiesta como un 422 que no dice cuál falta.
 */
export function buildWompiPayload(
  attributes: WompiPayloadAttributes,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    amount_in_cents: attributes.amountInCents,
    currency: attributes.currency,
    reference: attributes.reference,
    customer_email: attributes.customerEmail,
  };

  if (attributes.pseFields) {
    payload.payment_method = attributes.pseFields;
  }
  if (attributes.redirectUrl) {
    payload.redirect_url = attributes.redirectUrl;
  }
  if (attributes.acceptanceToken) {
    payload.acceptance_token = attributes.acceptanceToken;
  }
  if (attributes.integritySecret) {
    payload.signature = computeIntegritySignature(
      attributes.reference,
      attributes.amountInCents,
      attributes.currency,
      attributes.integritySecret,
    );
  }

  return payload;
}

/** Navegación defensiva sobre una respuesta de la que no se sabe nada todavía. */
function readObject(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

/** Identificador nativo de la transacción recién creada. */
export function extractTransactionId(rawResponse: unknown): string {
  const data = readObject(rawResponse, "data");
  const id = data?.id;
  return typeof id === "string" ? id : "";
}

/**
 * Estado y URL de redirección de una respuesta de Wompi.
 *
 * La URL vive en `payment_method.extra.async_payment_url`, y estar ausente es
 * el caso normal justo después de crear el pago, no un error. De ahí que el
 * campo del resultado sea opcional y que el sondeo tenga sentido.
 */
export function extractRedirectSnapshot(rawResponse: unknown): WompiRedirectSnapshot {
  const data = readObject(rawResponse, "data");
  const extra = readObject(readObject(data, "payment_method"), "extra");

  const status = typeof data?.status === "string" ? data.status : "";
  const url = extra?.async_payment_url;

  return {
    status,
    redirectUrl: typeof url === "string" && url.length > 0 ? url : undefined,
  };
}

/** Token de aceptación de términos, que Wompi entrega firmado y de un solo uso. */
export function extractAcceptanceToken(rawResponse: unknown): string | undefined {
  const data = readObject(rawResponse, "data");
  const presigned = readObject(data, "presigned_acceptance");
  const token = presigned?.acceptance_token;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Consulta la transacción hasta que aparezca la URL de redirección.
 *
 * ## Por qué no usa RetryHandler
 *
 * `RetryHandler.execute()` reintenta sobre **excepciones**, con backoff
 * exponencial. Que la URL todavía no esté no es un fallo: es un estado
 * intermedio esperado. Hacerlo pasar por ahí obligaría a lanzar una excepción
 * para señalar normalidad, y el pipeline de errores clasificaría ese estado
 * como error de pasarela. Son dos mecanismos con la misma forma y distinto
 * significado.
 *
 * ## Por qué lanza en vez de devolver algo
 *
 * Si se agota el límite, la alternativa sería devolver la transacción en
 * `PENDING` sin URL. Eso reproduce exactamente el defecto que `PaymentResult`
 * existe para impedir: el comercio recibe algo que parece válido, no redirige
 * nunca, y el pago se queda colgado hasta expirar. Por eso lanza, y el error
 * lleva el `gatewayTransactionId`: el pago **ya existe** en la pasarela, y
 * perder su identificador sería peor que el defecto original, porque volvería
 * irrastreable un cobro real.
 *
 * Recibe el lector por parámetro en vez de hacer el `fetch` acá para que las
 * pruebas puedan agotar el límite sin red y sin esperar tiempo real.
 */
export async function pollForRedirectUrl(
  gatewayTransactionId: string,
  readSnapshot: () => Promise<WompiRedirectSnapshot>,
  options: RedirectPollOptions = {},
): Promise<WompiRedirectSnapshot & { redirectUrl: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REDIRECT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_REDIRECT_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const deadline = now() + timeoutMs;

  for (;;) {
    const snapshot = await readSnapshot();
    if (snapshot.redirectUrl) {
      return { ...snapshot, redirectUrl: snapshot.redirectUrl };
    }
    if (now() >= deadline) {
      throw new KitPagosError(
        KitPagosErrorCode.GATEWAY_TIMEOUT,
        Gateway.WOMPI,
        null,
        `Wompi no publicó la URL de redirección de PSE en ${timeoutMs} ms. ` +
          `La transacción ${gatewayTransactionId} existe y quedó en ` +
          `'${snapshot.status}': consultar su estado con getStatus().`,
      );
    }
    await sleep(intervalMs);
  }
}

/**
 * Campos de PSE si el pago es PSE, nada si no.
 *
 * Existe como función de módulo y no como método privado del adaptador por el
 * CBO: el script de métricas cuenta los tipos que aparecen en **firmas de
 * métodos**, así que un método privado que devolviera `WompiPseFields` le sumaba
 * acoplamiento a una clase que ya estaba en 5 de 5. Acá el tipo no le cuesta
 * nada a nadie. Es el mismo criterio del punto 34.
 */
export function buildPseFieldsFor(
  paymentMethod: PaymentMethod | undefined,
  payer: Payer,
  orderReference: string,
): WompiPseFields | undefined {
  if (paymentMethod?.type !== "PSE") {
    return undefined;
  }
  return buildPseFields({
    bankCode: paymentMethod.bankCode ?? "",
    payerKind: paymentMethod.payerKind,
    payer,
    orderReference,
  });
}

/**
 * Convierte la respuesta de creación de un PSE en una redirección pendiente,
 * consultando si hace falta.
 *
 * Recibe el lector por parámetro y no hace HTTP: así el adaptador le pasa su
 * propia función de petición, con sus headers y su manejo de errores, y esta
 * función sigue siendo probable sin red.
 *
 * El caso en que la URL ya viene en la creación no se da hoy contra Wompi, pero
 * se contempla igual: es lo que la API de simulación puede producir, y si Wompi
 * algún día la incluyera, el sondeo se saltaría solo.
 */
export async function resolvePendingRedirect(
  rawResponse: unknown,
  readRaw: (gatewayTransactionId: string) => Promise<unknown>,
  options?: RedirectPollOptions,
): Promise<PendingRedirect> {
  const id = extractTransactionId(rawResponse);
  const created = extractRedirectSnapshot(rawResponse);

  const resolved = created.redirectUrl
    ? { ...created, redirectUrl: created.redirectUrl }
    : await pollForRedirectUrl(
        id,
        async () => extractRedirectSnapshot(await readRaw(id)),
        options,
      );

  return {
    redirectUrl: resolved.redirectUrl,
    gatewayTransactionId: new GatewayTransactionId(id, Gateway.WOMPI),
    rawStatus: resolved.status,
  };
}

/**
 * Traduce la respuesta de `GET /v1/pse/financial_institutions` a la lista
 * unificada de bancos.
 *
 * Forma medida contra el sandbox el 18 de septiembre de 2026:
 *
 * ```json
 * { "data": [ { "financial_institution_code": "1",
 *               "financial_institution_name": "Banco que aprueba" } ], "meta": {} }
 * ```
 *
 * El sandbox devuelve **tres** entidades y ninguna es un banco real: se llaman
 * "Banco que aprueba", "Banco que declina" y "Banco que simula un error", con
 * códigos 1, 2 y 3, y son las que fuerzan cada desenlace (punto 43). Los nombres
 * se devuelven tal cual, sin disimular que son de prueba: un comercio que ve
 * "Banco que declina" en su selector sabe al instante que está apuntando al
 * sandbox, y eso es más útil que un nombre inventado que parezca de producción.
 */
export function parseWompiPseBanks(rawResponse: unknown): PseBank[] {
  const payload = rawResponse as { data?: unknown } | null;
  const entries = Array.isArray(payload?.data) ? payload!.data : [];

  return entries.flatMap((entry) => {
    const bank = entry as Record<string, unknown>;
    const code = bank.financial_institution_code;
    const name = bank.financial_institution_name;

    // Una entrada sin código no se puede usar para cobrar, así que se descarta en
    // vez de llegar al selector del comercio como una opción que falla al elegirla.
    if (typeof code !== "string" || code.length === 0) {
      return [];
    }

    return [{ code, name: typeof name === "string" ? name : code }];
  });
}
