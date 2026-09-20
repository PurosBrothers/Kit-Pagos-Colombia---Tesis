import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";
import { GatewayTransactionId } from "../../domain/value-objects/GatewayTransactionId";
import type { PendingRedirect } from "../../domain/value-objects/PaymentResult";
import type { PseBank } from "../../domain/value-objects/PseBank";
import type { PayerKind } from "../../domain/value-objects/PaymentMethod";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";
import type { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";

/**
 * PSE en Kushki, que Kushki llama **Transfer In**.
 *
 * No existe un método `pse` en su API: el mecanismo se llama `transfer`, y su
 * propia documentación dice que es con lo que los usuarios pagan por PSE
 * (verificado en el issue #68). Es la pasarela que más se aparta de las otras
 * tres, en tres cosas a la vez:
 *
 * 1. **Son tres llamadas**: lista de bancos, token e inicio. Y la lista no es
 *    opcional: la referencia de Kushki dice que el endpoint *"is required only for
 *    Transfer In payment method in Colombia"*, o sea que en Colombia elegir banco
 *    de la lista es parte del método, no una comodidad.
 * 2. **La URL de retorno del comercio viaja en el paso del token**, no en el del
 *    cobro. Es el único caso de las cuatro donde eso pasa, y la razón por la que
 *    `ReturnUrlConfig` no estaba cableado en este adaptador: el camino de tarjeta
 *    de Kushki es transparente y síncrono y no tiene dónde ponerla (punto 46).
 * 3. **El destino de la redirección no es predecible desde el código.** Kushki
 *    tiene PSE 1.0 y PSE Avanza 2.0, y en la primera la URL lleva al portal de PSE
 *    —donde el pagador todavía tiene que pulsar "Ir al banco"— y en la segunda
 *    directo al banco. Depende de la configuración del comercio, así que el SDK no
 *    debe documentar que lleva al banco.
 *
 * ## Qué está medido acá
 *
 * Este módulo se escribió primero contra la documentación, porque no había
 * credenciales de API, y **después se midió contra la API UAT real** el 18 de
 * septiembre de 2026, ejecutando el flujo completo con las credenciales del
 * comercio de prueba. Medir encontró cuatro defectos que las pruebas unitarias no
 * podían ver, porque el simulador reproducía lo que el código esperaba:
 *
 * 1. `POST /transfer/v1/init` **no acepta solo el token**: hay que repetirle el
 *    monto (ver `buildTransferInitPayload`).
 * 2. La lista de bancos **empieza con un elemento que no es un banco** (ver
 *    `parseKushkiPseBanks`).
 * 3. La consulta de estado devuelve una forma que el normalizador de tarjeta **no
 *    puede leer** (ver `kushki-transfer.ts` en la capa de aplicación).
 * 4. Los estados de transferencia son otro vocabulario —`requestedToken`,
 *    `initializedTransaction`— y ninguno estaba en la tabla, así que una
 *    transferencia en curso se reportaba como error.
 *
 * Todo eso está en el punto 48 del `architecture-log.md`. Lo que **sigue sin
 * medir** es el desenlace final: llevar una transferencia hasta `APPROVED` o
 * `DECLINED` exige que una persona autorice en el portal del banco simulado, así
 * que los estados finales de la tabla vienen de la documentación de Kushki y están
 * marcados como tales.
 */

/**
 * Código con el que Kushki encabeza su lista de bancos, y que no es un banco.
 *
 * Medido: la lista real empieza con `{ code: "0", name: "A continuación seleccione
 * su banco" }`, el texto de relleno de un `<select>` viajando dentro de los datos.
 */
const PLACEHOLDER_BANK_CODE = "0";

/**
 * Estado nativo de una transferencia recién iniciada.
 *
 * Medido con la consulta de estado inmediatamente después de `init`. Se usa como
 * valor a reportar cuando la respuesta de `init` no trae estado, que es siempre:
 * esa respuesta no incluye ningún campo de estado.
 */
const INITIALIZED_TRANSFER_STATUS = "initializedTransaction";

/**
 * Tipos de documento válidos para Colombia.
 *
 * El enum de la API incluye además `RUC`, `CURP`, `RFC`, `RUT`, `DNI`, `PAS`,
 * `CI` y `DE`, que son de otros países. No se aceptan acá: que la API los liste no
 * los hace válidos para una transacción colombiana, y dejarlos pasar sería
 * aceptar localmente algo que Kushki va a rechazar después.
 */
export const KUSHKI_DOCUMENT_TYPES: readonly string[] = [
  "CC",
  "NIT",
  "CE",
  "TI",
  "PP",
];

/**
 * Traduce la naturaleza del pagador al `userType` de Kushki.
 *
 * `"0"` es persona natural y `"1"` jurídica, igual que el `user_type` de Wompi.
 * Sin `payerKind` se asume natural, que es el caso mayoritario en un checkout y el
 * mismo valor por omisión que ya toma el camino de Wompi.
 */
function toUserType(payerKind?: PayerKind): string {
  return payerKind === "LEGAL" ? "1" : "0";
}

/**
 * Falla, antes de tocar la red, si falta algo que Kushki va a exigir.
 *
 * Acumula en vez de cortar en el primero por lo mismo que en Rapyd y Mercado
 * Pago: un comercio que integra merece la lista completa en un intento. Y acá
 * importa más que en ninguna, porque el flujo son tres llamadas y un rechazo en la
 * tercera deja atrás un token ya emitido.
 */
export function assertPseRequirements(request: CreatePaymentRequest): void {
  const missing: string[] = [];
  const { payer } = request;

  if (!payer.documentType) {
    missing.push("payer.documentType");
  }
  if (!payer.documentNumber) {
    missing.push("payer.documentNumber");
  }
  // El banco no se verifica: `PaymentMethod.pse()` ya impide construirse sin él, y
  // a diferencia de Rapyd, Kushki no publica un formato de `bankId` contra el que
  // comparar, así que tampoco hay nada más que comprobar localmente.
  // La URL de retorno es obligatoria y no opcional como en tarjeta: Kushki la
  // exige al pedir el token, y sin ella el pagador llega al banco sin un camino
  // de vuelta al comercio.
  if (!request.returnUrlConfig?.resolveFor("PENDING")) {
    missing.push("returnUrlConfig con una URL aplicable a PENDING");
  }

  if (missing.length > 0) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.KUSHKI,
      null,
      `PSE en Kushki exige datos que faltan en la solicitud: ${missing.join(", ")}.`,
    );
  }

  const documentType = payer.documentType as string;
  if (!KUSHKI_DOCUMENT_TYPES.includes(documentType)) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.KUSHKI,
      null,
      `Kushki no acepta el tipo de documento "${documentType}" para Colombia. ` +
        `Válidos: ${KUSHKI_DOCUMENT_TYPES.join(", ")}.`,
    );
  }
}

/**
 * Arma el cuerpo de `POST /transfer/v1/tokens`, la primera de las tres llamadas.
 *
 * El monto va descompuesto en componentes tributarios, igual que en el camino de
 * tarjeta de Kushki y por la misma razón: Kushki no recibe un total, recibe las
 * partes. En pesos nominales, no en centavos.
 */
export function buildTransferTokenPayload(
  request: CreatePaymentRequest,
  taxBreakdown: TaxBreakdown,
): Record<string, unknown> {
  return {
    bankId: request.paymentMethod?.bankCode,
    // Acá es donde `ReturnUrlConfig` finalmente se usa en Kushki. Se resuelve
    // para PENDING porque el pagador vuelve del banco antes de que la
    // transferencia esté confirmada: es el mismo criterio que el camino de Wompi.
    callbackUrl: request.returnUrlConfig?.resolveFor("PENDING"),
    userType: toUserType(request.paymentMethod?.payerKind),
    documentType: request.payer.documentType,
    documentNumber: request.payer.documentNumber,
    email: request.payer.email,
    currency: request.currency.getCode(),
    paymentDescription: request.orderReference.getValue(),
    amount: buildTransferAmount(taxBreakdown, request.currency.getCode()),
  };
}

/**
 * Descompone el monto como Kushki lo espera en el flujo de transferencia.
 *
 * Está compartido entre el token y el inicio porque **los dos pasos lo piden**, y
 * si las dos copias se separaran el segundo fallaría con un `400` que no dice qué
 * componente no coincide.
 */
function buildTransferAmount(
  taxBreakdown: TaxBreakdown,
  currencyCode: string,
): Record<string, unknown> {
  return {
    subtotalIva0: Number(taxBreakdown.subtotalIva0.getValue()),
    subtotalIva: Number(taxBreakdown.subtotalIva.getValue()),
    iva: Number(taxBreakdown.iva.getValue()),
    ice: Number(taxBreakdown.ice.getValue()),
    currency: currencyCode,
  };
}

/**
 * Arma el cuerpo de `POST /transfer/v1/init`, la segunda llamada.
 *
 * **El token no alcanza.** Medido contra la API UAT el 18 de septiembre de 2026:
 * `{ token }` a secas responde `400 T001 "Cuerpo de la petición inválido."`, y el
 * mismo token con `{ token, amount }` responde `201`. Hay que repetir el monto que
 * ya se mandó al pedir el token, aunque Kushki lo tenga guardado —la consulta de
 * estado lo devuelve— y aunque su documentación no lo pida.
 *
 * Mandar el resto del cuerpo del token tampoco sirve: con todos los campos
 * repetidos vuelve a responder `400`. O sea que no es "cuantos más datos, mejor":
 * es exactamente el token y el monto.
 */
export function buildTransferInitPayload(
  token: string,
  taxBreakdown: TaxBreakdown,
  currencyCode: string,
): Record<string, unknown> {
  return {
    token,
    amount: buildTransferAmount(taxBreakdown, currencyCode),
  };
}

/** Saca el token de la respuesta del primer paso. */
export function extractTransferToken(rawResponse: unknown): string {
  const payload = rawResponse as { token?: unknown } | null;
  const token = payload?.token;

  if (typeof token !== "string" || token.length === 0) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      Gateway.KUSHKI,
      null,
      "Kushki no devolvió el token de la transferencia, que es obligatorio para iniciarla.",
    );
  }

  return token;
}

/**
 * Saca la redirección de la respuesta de `POST /transfer/v1/init`.
 *
 * El identificador de la transacción es **el token**, no un id nuevo: la consulta
 * de estado es `GET /transfer/v1/status/{token}`. Por eso el token del primer paso
 * es lo que viaja como `gatewayTransactionId`, y el comercio lo usa después en
 * `getPaymentStatus()` sin saber que es un token.
 */
export function extractTransferRedirect(
  rawResponse: unknown,
  token: string,
): PendingRedirect {
  const payload = rawResponse as { redirectUrl?: unknown; status?: unknown } | null;
  const redirectUrl = payload?.redirectUrl;

  if (typeof redirectUrl !== "string" || redirectUrl.length === 0) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      Gateway.KUSHKI,
      null,
      "Kushki inició la transferencia pero no devolvió la URL de redirección, " +
        "sin la cual el pagador no puede autorizarla en su banco.",
    );
  }

  return {
    redirectUrl,
    gatewayTransactionId: new GatewayTransactionId(token, Gateway.KUSHKI),
    // La respuesta de `init` no trae estado: medido, devuelve `bankId`, `bankName`,
    // `redirectUrl`, `transactionReference` y `trazabilityCode`, nada más. El estado
    // hay que consultarlo, y en ese momento la transferencia está en
    // `initializedTransaction`, que es el valor nativo que se reporta acá. Antes
    // decía `INITIALIZED`, que es el vocabulario de tarjeta y un valor que Kushki
    // nunca devuelve para una transferencia.
    rawStatus:
      typeof payload?.status === "string"
        ? payload.status
        : INITIALIZED_TRANSFER_STATUS,
  };
}

/**
 * Traduce `GET /transfer/v1/bankList` a la lista unificada de bancos.
 *
 * Forma medida contra la API UAT real el 18 de septiembre de 2026: un arreglo de
 * `{ code, name }`. Se aceptan también `id` y `bankId` como nombre del campo del
 * código porque la referencia de Kushki no es consistente entre secciones.
 *
 * ## El primer elemento no es un banco
 *
 * La lista real empieza con `{ code: "0", name: "A continuación seleccione su
 * banco" }`, que es el texto de relleno de un `<select>` viajando dentro de los
 * datos. Hay que descartarlo, y no es un detalle cosmético: es la primera entrada,
 * así que un comercio que muestre la lista tal cual ofrece "A continuación
 * seleccione su banco" como si fuera una entidad financiera, y cualquier código
 * que tome el primer elemento cobra contra el banco `"0"`, que no existe.
 *
 * Se filtra por el código y no por el texto porque el código es lo que el SDK
 * usa: `"0"` no identifica a ninguna entidad en ninguna de las cuatro pasarelas,
 * mientras que el texto depende del idioma de la cuenta.
 */
export function parseKushkiPseBanks(rawResponse: unknown): PseBank[] {
  const entries = Array.isArray(rawResponse)
    ? rawResponse
    : Array.isArray((rawResponse as { banks?: unknown })?.banks)
      ? ((rawResponse as { banks: unknown[] }).banks)
      : [];

  return entries.flatMap((entry) => {
    const bank = entry as Record<string, unknown>;
    const rawCode = bank.code ?? bank.id ?? bank.bankId;
    const code =
      typeof rawCode === "string"
        ? rawCode
        : typeof rawCode === "number"
          ? String(rawCode)
          : "";

    if (code.length === 0 || code === PLACEHOLDER_BANK_CODE) {
      return [];
    }

    const name = bank.name ?? bank.description;
    return [{ code, name: typeof name === "string" ? name : code }];
  });
}

/**
 * Rutas de consulta de estado de Kushki, en el orden en que hay que probarlas.
 *
 * ## Por qué esto es una lista y no una decisión
 *
 * Porque Kushki consulta cada método en una ruta distinta —`/charges/{ticketNumber}`
 * para tarjeta y `/transfer/v1/status/{token}` para transferencia— y **no publica
 * ningún discriminador** entre los dos identificadores.
 *
 * Se consideró deducirlo de la forma, como hace el adaptador de Mercado Pago, que
 * elige entre la Orders API y la Payments API según el prefijo `ORD`. No es
 * comparable: ese prefijo está documentado y se midió, mientras que acá la regla
 * candidata —"el ticket de tarjeta es solo dígitos"— no se pudo verificar contra la
 * API, y basta que Kushki emita un token de solo dígitos para mandar la consulta a
 * la ruta equivocada y reportar "no existe" sobre un pago que sí existe.
 *
 * Así que en vez de adivinar, el adaptador **pregunta**: intenta la primera ruta y,
 * solo si Kushki responde que no sabe de ese identificador, prueba la siguiente.
 *
 * ## Por qué la transferencia va primero, contra la intuición
 *
 * La primera versión probaba tarjeta primero, con el argumento de que es el método
 * mayoritario y así el caso común no paga la llamada extra. Medir la API UAT el 18
 * de septiembre de 2026 mostró que ese orden **no puede funcionar**:
 * `GET /charges/{id}` responde `403 Forbidden` para cualquier identificador, y lo
 * mismo responde una ruta de control que no existe. O sea que esa ruta nunca emite
 * un "no existe" del que se pueda encadenar, y el respaldo nunca se activaría.
 *
 * La de transferencia sí discrimina: devuelve `200` con el estado para un token que
 * conoce, y `400 T001` para uno que no. Así que es la única que puede ir primero.
 *
 * El corolario incómodo hay que decirlo: **Kushki no expone ninguna ruta de consulta
 * de cobros con tarjeta que se haya podido encontrar.** El 19 de septiembre se
 * probaron catorce candidatas con un `ticketNumber` real recién emitido —entre ellas
 * `/charges/{id}`, `/card/v1/charges/{id}`, `/card/v1/transaction/{id}`,
 * `/analytics/v1/transaction/{id}` y `/card/v1/charges/{id}/status`— y **todas**
 * respondieron como la ruta de control inventada: `403 Forbidden` las que están bajo
 * la raíz, y `403 "Missing Authentication Token"` las que están bajo `/card/v1`.
 *
 * `/charges/{id}` se deja en la lista porque es la que el simulador implementa y con
 * la que el ejemplo de tarjeta muestra el ciclo de vida completo. Contra Kushki real,
 * el estado final de un cobro con tarjeta llega por webhook, y el cobro mismo ya trae
 * su estado resuelto porque se pide con `fullResponse: true` (ver `kushki-charge.ts`).
 * Lo medido está en el punto 50 del `architecture-log.md`.
 */
export function kushkiStatusPaths(gatewayTransactionId: string): readonly string[] {
  return [
    `/transfer/v1/status/${gatewayTransactionId}`,
    `/charges/${gatewayTransactionId}`,
  ];
}

/**
 * Decide qué hacer con el fallo de una de las rutas de consulta: seguir probando, o con qué
 * error rendirse.
 *
 * Devuelve `undefined` cuando la pasarela dijo que no conoce ese identificador, que es la
 * señal para probar la siguiente ruta. Devuelve el error con el que hay que rendirse en
 * cualquier otro caso.
 *
 * ## El defecto que esto corrige, que es el número veinte del proyecto
 *
 * Medido el 19 de septiembre de 2026 con credenciales UAT nuevas: un comercio que cobra con
 * tarjeta en Kushki —`201`, estado `APPROVAL`— y después llama a `getPaymentStatus()` con el
 * `ticketNumber` que Kushki le dio recibía **`INVALID_CREDENTIALS: "Kushki gateway returned
 * an HTTP error status 403"`**. Con las credenciales buenas. O sea que el SDK lo mandaba a
 * rotar llaves que no tenían nada.
 *
 * El 403 no era de autorización: era de una ruta que no existe. Se confirmó con dos rutas de
 * control inventadas, y ahí está la parte que no se puede deducir leyendo:
 *
 * | Ruta | Respuesta |
 * | --- | --- |
 * | `/card/v1/charges/{ticket real}` | `403 "Missing Authentication Token"` |
 * | `/card/v1/rutaInventada/{ticket real}` | `403 "Missing Authentication Token"` |
 * | `/charges/{ticket real}` | `403 "Forbidden"` |
 * | `/rutaInventada/abc123` | `403 "Forbidden"` |
 *
 * Una ruta candidata y una inventada contestan **lo mismo, carácter por carácter**, así que
 * bajo esa raíz no hay forma de distinguir "no autorizado" de "no existe". Se probaron
 * veinticuatro combinaciones de ruta e identificador entre las dos mediciones, con el
 * `ticketNumber` y con el `transactionId`, y ninguna contestó distinto de una inventada.
 *
 * ## Por qué acá sí se puede afirmar que el 403 no es de credenciales
 *
 * Porque **a la segunda ruta solo se llega si la primera contestó desde la aplicación**. Con
 * credenciales inválidas, `GET /transfer/v1/status/{id}` responde `403` y el adaptador se
 * rinde ahí mismo, sin llegar acá. Si contestó `400 T001` —"cuerpo de la petición
 * inválido"—, eso es la aplicación de Kushki hablando, o sea que la llave privada pasó el
 * autorizador. Un `403` después de eso no puede ser de la llave: es la ruta.
 *
 * Ese razonamiento es todo el contenido del parámetro `credentialsAlreadyProven`, y por eso
 * no se puede resolver mirando el error solo.
 *
 * ## Qué le queda al comercio
 *
 * No queda sin el dato, y el mensaje se lo dice: el cobro con tarjeta **ya trae su estado
 * resuelto** en la respuesta de creación, porque el adaptador lo pide con `fullResponse:
 * true`, y los cambios posteriores llegan por webhook, que el SDK sí verifica para Kushki.
 * Lo que no hay es sondeo, y ahora el error lo nombra en vez de acusar a las credenciales.
 */
export function kushkiStatusFailure(
  error: unknown,
  credentialsAlreadyProven: boolean,
  gatewayTransactionId: string,
): unknown {
  if (isUnknownToRoute(error)) {
    return undefined;
  }

  const esForbidden =
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.INVALID_CREDENTIALS;

  if (credentialsAlreadyProven && esForbidden) {
    return new KitPagosError(
      KitPagosErrorCode.UNSUPPORTED_OPERATION,
      Gateway.KUSHKI,
      null,
      `Kushki no expone una ruta para consultar el estado de un cobro con tarjeta, así que ` +
        `no se puede consultar ${gatewayTransactionId}. No te quedás sin el dato: el cobro ` +
        `ya devuelve su estado final en la respuesta de createPayment(), y los cambios ` +
        `posteriores llegan por webhook, que podés verificar con validateWebhook(). Esto no ` +
        `es un problema de tus credenciales: la consulta de transferencias con estas mismas ` +
        `llaves respondió bien.`,
    );
  }

  return error;
}

/**
 * Distingue "esta ruta no sabe de ese identificador" de cualquier otro fallo.
 *
 * Acepta dos códigos porque Kushki y el simulador contestan distinto lo mismo: la API real
 * responde `400` (`T001`, "cuerpo de la petición inválido") cuando el identificador no es de
 * esa ruta, y el simulador responde `404`. Medido contra la API UAT el 18 de septiembre de
 * 2026; antes solo se aceptaba `404`, así que contra Kushki real el respaldo no se activaba
 * nunca.
 *
 * Deliberadamente **no** incluye `INVALID_CREDENTIALS`: un 401 o un 403 puede ser una llave
 * mal configurada, y seguir probando rutas convertiría ese problema en un "no encontrado"
 * que manda a buscar al lugar equivocado. El caso en que un 403 sí significa otra cosa lo
 * resuelve `kushkiStatusFailure()`, que tiene el contexto para afirmarlo.
 */
function isUnknownToRoute(error: unknown): boolean {
  return (
    error instanceof KitPagosError &&
    (error.code === KitPagosErrorCode.RESOURCE_NOT_FOUND ||
      error.code === KitPagosErrorCode.INVALID_REQUEST)
  );
}
