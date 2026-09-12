/**
 * Ejemplo end-to-end de un pago simulado con Rapyd (issue #52).
 *
 * Este archivo demuestra la integración del SDK desde la perspectiva de un
 * comercio externo consumiendo el paquete `kit-pagos-colombia`.
 *
 * Rapyd es la más exigente de las cuatro pasarelas, y por eso este ejemplo es el
 * que mejor muestra qué es lo que el SDK está absorbiendo: la firma HMAC que hay
 * que recalcular en cada petición, el monto en pesos en vez de centavos, y un
 * catálogo de estados de tres letras. Ninguna de esas tres cosas aparece en el
 * código de abajo, y ese es exactamente el punto.
 *
 * Requisito para correrlo: la API de Simulación debe estar corriendo en el puerto 3000:
 *   cd simulator-api && npm run dev
 */
import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  KitPagosError,
  KitPagosErrorCode,
  type SDKOptions,
} from "kit-pagos-colombia";

/**
 * Endpoint del mock de Rapyd en la API de Simulación local.
 *
 * Es la URL de la colección de pagos: el SDK hace POST acá para crear y le
 * agrega `/{id}` para consultar. Contra el sandbox real de Rapyd el valor
 * equivalente sería `https://sandboxapi.rapyd.net/v1/payments`. Esto, igual que
 * las llaves, debería vivir en un archivo de configuración externo como un .env.
 */
const SIMULATOR_RAPYD_URL = "http://localhost:3000/v1/sim/rapyd/payments";

/**
 * Paso 1: Configurar el SDK para Rapyd.
 *
 * `Credentials` es el mismo objeto de valor para las cuatro pasarelas, aunque
 * Rapyd nombre sus llaves de otra forma: `publicKey` es su `access_key` (que
 * identifica a la organización y viaja en claro en un header) y `privateKey` es
 * su `secret_key`, que nunca se transmite sola — solo entra al cálculo de la
 * firma. El comercio no tiene que saber eso: escribe sus dos llaves y el
 * adaptador se encarga.
 */
const options: SDKOptions = {
  gateway: Gateway.RAPYD,
  credentials: {
    [Gateway.RAPYD]: {
      publicKey: "rapyd_access_key_ejemplo_no_real",
      privateKey: "rapyd_secret_key_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_RAPYD_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — Ejemplo de pago simulado con Rapyd ===\n");
  console.log(`Pasarela activa: ${Gateway.RAPYD}`);
  console.log(`Endpoint:        ${SIMULATOR_RAPYD_URL}\n`);

  /**
   * Paso 2: Describir el pago con el vocabulario de dominio unificado.
   *
   * Es exactamente el mismo código que en los ejemplos de Wompi y Mercado Pago.
   * El monto se escribe como texto y no como número porque es el único tipo que
   * conserva la escala: `new Amount("150000.00")` sigue valiendo "150000.00" al
   * leerlo, mientras `150000.00` en JavaScript es indistinguible de `150000`.
   *
   * Con Rapyd esa diferencia deja de ser una sutileza y se vuelve un requisito
   * de la pasarela. Rapyd calcula la firma de la petición sobre el cuerpo
   * serializado, donde "19.90" y "19.9" son dos cadenas distintas y por lo tanto
   * dos firmas distintas. Su propia documentación instruye enviar los montos con
   * ceros a la derecha como strings numéricos por esta razón.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-RAPYD-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
    }),
  };

  console.log("Solicitud de pago:");
  console.log(`  Monto:      ${request.amount.getValue()} ${request.currency.getCode()} (pesos con decimales, no centavos)`);
  console.log(`  Referencia: ${request.orderReference.getValue()}`);
  console.log(`  Pagador:    ${request.payer.email}\n`);

  /**
   * Paso 3: Crear el pago en Rapyd.
   *
   * Una sola llamada a través de la fachada. Detrás de esta línea el adaptador
   * generó un salt aleatorio, tomó el timestamp Unix, serializó el cuerpo una
   * sola vez, calculó la firma HMAC-SHA256 sobre método, path, salt, timestamp y
   * las dos llaves, y mandó los cuatro headers que Rapyd exige. Nada de eso se
   * ve acá, y por eso el mismo código sirve para las cuatro pasarelas.
   */
  console.log("Creando el pago...");
  const transaction = await kitPagos.createPayment(request);

  console.log("Transacción creada exitosamente:");
  console.log(`  ID en la pasarela:  ${transaction.gatewayTransactionId.value}`);
  console.log(`  Pasarela de origen: ${transaction.gatewayTransactionId.gateway}`);
  console.log(`  Estado normalizado: ${transaction.getStatus()}`);
  console.log(`  Estado nativo:      ${transaction.rawStatus} (código propio de Rapyd, conservado para auditoría)`);
  console.log(`  Monto:              ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
  console.log(`  Referencia:         ${transaction.orderReference.getValue()}`);
  console.log(`  Pagador:            ${transaction.payer.email}`);
  console.log(`  Aprobada:           ${transaction.isApproved()}`);
  console.log(`  Estado final:       ${transaction.isFinal()}\n`);

  /**
   * Paso 4: Consultar el estado del pago por su identificador.
   *
   * En Rapyd este flujo sí funciona contra el simulador. Vale notar que la
   * consulta se firma igual que la creación: a diferencia de Wompi, Rapyd no
   * tiene un esquema reducido de solo lectura donde bastara una llave pública.
   */
  console.log("Consultando el estado de la transacción en Rapyd...");
  const consulted = await kitPagos.getPaymentStatus(
    transaction.gatewayTransactionId.value
  );

  console.log("Transacción consultada exitosamente:");
  console.log(`  ID consultado:      ${consulted.gatewayTransactionId.value}`);
  console.log(`  Estado normalizado: ${consulted.getStatus()}`);
  console.log(`  Estado nativo:      ${consulted.rawStatus}\n`);

  /**
   * Cierre: qué demostró el ejemplo.
   *
   * El estado nativo que imprimió el paso 3 es "CLO", que en el catálogo de
   * Rapyd significa "cerrado". El SDK lo tradujo a APPROVED, pero solo porque la
   * respuesta además traía `paid: true`: un pago cerrado sin pagar no es una
   * aprobación, y leer únicamente el estado daría por cobrado lo que no se cobró.
   * Ese tipo de detalle por pasarela es lo que el comercio deja de tener que
   * saber, y es la razón de existir del enum unificado.
   */
  console.log("=== Fin del ejemplo de Rapyd ===");
}

main().catch((error: unknown) => {
  if (
    error instanceof KitPagosError &&
    error.code === KitPagosErrorCode.CONNECTION_FAILED
  ) {
    console.error("\nNo se pudo conectar con la API de Simulación.");
    console.error("Asegúrate de haberla iniciado en otra terminal:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\nEl ejemplo falló de forma inesperada:");
  console.error(error);
  process.exit(1);
});
