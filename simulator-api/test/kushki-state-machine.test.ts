import {
  KushkiChargeResponse,
  KushkiTransferStatusResponse,
} from "../src/gateways/kushki/types";
import {
  kushkiChargeMachine,
  kushkiTransferMachine,
} from "../src/state/kushkiStateMachine";
import { rememberScenarioTarget } from "../src/state/scenarioTarget";
import { resetSimulatorState } from "../src/store/GatewayStores";

/**
 * Pruebas de las tablas de Kushki (issue #124, criterio 4).
 *
 * Kushki tiene dos vocabularios de estado, y no son el mismo en otro formato: son
 * `APPROVAL` / `DECLINED` / `INITIALIZED` para tarjeta y `requestedToken` /
 * `initializedTransaction` / `approvedTransaction` / `declinedTransaction` para
 * transferencias. Por eso hay dos tablas, y por eso una prueba que copie un `switch` de otra
 * pasarela las falla de inmediato.
 *
 * Los identificadores también son dos: 18 hexadecimales para el ticket de tarjeta y 32 para
 * el token de transferencia, sin forma pública de distinguirlos.
 */

function cargo(
  estado: KushkiChargeResponse["details"]["transactionStatus"],
): KushkiChargeResponse {
  return {
    ticketNumber: "a263b3997a5b446985",
    transactionReference: "adb294b7-a13b-480b-8c63-8a6641b31d8d",
    details: {
      transactionStatus: estado,
      trackingCode: "ORD-KUSHKI-77",
      subtotalIva0: 35000,
      subtotalIva: 0,
      ivaValue: 0,
      iceValue: 0,
      currencyCode: "COP",
      approvedTransactionAmount: 35000,
      responseText: "",
      contactDetails: { email: "comprador@example.com" },
    },
  };
}

function transferencia(
  estado: KushkiTransferStatusResponse["status"],
): KushkiTransferStatusResponse {
  return {
    status: estado,
    token: "16ea5d8beeed4d98948efb09b4d41d9f",
    paymentDescription: "ORD-KUSHKI-PSE-9",
    email: "comprador@example.com",
    amount: {
      subtotalIva0: 35000,
      subtotalIva: 0,
      iva: 0,
      ice: 0,
      currency: "COP",
    },
    transactionReference: "adb294b7-a13b-480b-8c63-8a6641b31d8d",
    bankId: "007",
    documentType: "CC",
    documentNumber: "1099888777",
    currency: "COP",
    country: "CO",
    created: 1789775019,
    merchantName: "Comercio de prueba",
    callbackUrl: "https://comercio.example.com/retorno",
  };
}

describe("Tabla de cobros con tarjeta de Kushki", () => {
  it.each([["APPROVAL"], ["DECLINED"]] as const)(
    "un cargo en %s no vuelve a moverse al consultarse",
    (estado) => {
      // El criterio 1 del issue. Además `DECLINED` tiene que quedarse en `DECLINED`: si
      // tuviera transición, la consulta lo movería a `APPROVAL` y un cobro rechazado se
      // reportaría como cobrado.
      const final = cargo(estado);

      expect(kushkiChargeMachine.transition(final, "query")).toBe(final);
      expect(kushkiChargeMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it("un cargo INITIALIZED se acredita al consultarlo", () => {
    const consultado = kushkiChargeMachine.transition(cargo("INITIALIZED"), "query");

    expect(consultado.details.transactionStatus).toBe("APPROVAL");
    expect(kushkiChargeMachine.canTransition(cargo("INITIALIZED"), "query")).toBe(true);
  });

  it("escribe el estado en details y no en la raíz", () => {
    // La forma medida contra la API UAT: el estado vive en `details.transactionStatus`, en
    // camelCase, mientras que el `ticketNumber` sí está en la raíz. Si la máquina escribiera
    // en `transaction_status` en la raíz, el normalizador del SDK no encontraría el estado
    // y el cobro se reportaría sin resolver.
    const consultado = kushkiChargeMachine.transition(cargo("INITIALIZED"), "query");

    expect(consultado.details.transactionStatus).toBe("APPROVAL");
    expect(consultado.ticketNumber).toBe("a263b3997a5b446985");
  });

  it("no pierde los otros campos de details al cambiar el estado", () => {
    const consultado = kushkiChargeMachine.transition(cargo("INITIALIZED"), "query");

    expect(consultado.details.subtotalIva0).toBe(35000);
    expect(consultado.details.currencyCode).toBe("COP");
    expect(consultado.details.trackingCode).toBe("ORD-KUSHKI-77");
    expect(consultado.details.contactDetails?.email).toBe("comprador@example.com");
  });

  it("no muta el cargo que recibe", () => {
    const original = cargo("INITIALIZED");
    const copia = structuredClone(original);

    kushkiChargeMachine.transition(original, "query");

    expect(original).toEqual(copia);
    expect(original.details.transactionStatus).toBe("INITIALIZED");
  });
});

describe("Tabla de transferencias de Kushki", () => {
  it("el token emitido arranca en requestedToken", () => {
    // La primera transición no la dispara nada: se queda donde nació. El avance real lo
    // hace `init`, que es lo medido —"pasa a initializedTransaction al iniciarla"—.
    const emitida = transferencia("requestedToken");

    expect(kushkiTransferMachine.transition(emitida, "query")).toBe(emitida);
    expect(kushkiTransferMachine.canTransition(emitida, "query")).toBe(false);
  });

  it("init lleva requestedToken a initializedTransaction", () => {
    const iniciada = kushkiTransferMachine.transition(
      transferencia("requestedToken"),
      "pay",
    );

    expect(iniciada.status).toBe("initializedTransaction");
    expect(kushkiTransferMachine.canTransition(transferencia("requestedToken"), "pay")).toBe(
      true,
    );
  });

  it("la consulta cierra la transferencia ya iniciada", () => {
    const cerrada = kushkiTransferMachine.transition(
      transferencia("initializedTransaction"),
      "query",
    );

    expect(cerrada.status).toBe("approvedTransaction");
  });

  it("una transferencia iniciada no avanza con una petición que no es consulta", () => {
    // Transición no permitida: el segundo pago ya ocurrió, es el paso de `init`.
    const iniciada = transferencia("initializedTransaction");

    expect(kushkiTransferMachine.transition(iniciada, "pay")).toBe(iniciada);
  });

  it.each([["approvedTransaction"], ["declinedTransaction"]] as const)(
    "una transferencia en %s no vuelve a moverse al consultarse",
    (estado) => {
      // El criterio 1 del issue: una transferencia aprobada se consulta como aprobada.
      const final = transferencia(estado);

      expect(kushkiTransferMachine.transition(final, "query")).toBe(final);
      expect(kushkiTransferMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it("conserva el token, el monto y la referencia del comercio", () => {
    const cerrada = kushkiTransferMachine.transition(
      transferencia("initializedTransaction"),
      "query",
    );

    // El token es el dato con el que se consultó, así que tiene que seguir siendo el mismo.
    expect(cerrada.token).toBe("16ea5d8beeed4d98948efb09b4d41d9f");
    expect(cerrada.paymentDescription).toBe("ORD-KUSHKI-PSE-9");
    expect(cerrada.amount.subtotalIva0).toBe(35000);
    expect(cerrada.callbackUrl).toBe("https://comercio.example.com/retorno");
    expect(cerrada.bankId).toBe("007");
  });

  it("no muta la transferencia que recibe", () => {
    const original = transferencia("initializedTransaction");
    const copia = structuredClone(original);

    kushkiTransferMachine.transition(original, "query");

    expect(original).toEqual(copia);
    expect(original.status).toBe("initializedTransaction");
  });
});
describe("el desenlace registrado por el escenario", () => {
  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  it("la tabla usa el estado registrado en vez del destino por defecto", () => {
    // Es lo que hace alcanzable `declinedTransaction`: sin escenario registrado, la
    // transición iba siempre a `approvedTransaction` y el rechazo no se podía pedir.
    const token = "16ea5d8beeed4d98948efb09b4d41d9f";

    rememberScenarioTarget("kushki", "transfer", token, "declinedTransaction");

    const cerrada = kushkiTransferMachine.transition(
      transferencia("initializedTransaction"),
      "query",
    );

    expect(cerrada.status).toBe("declinedTransaction");
  });

  it("sin escenario registrado la transición va a aprobado", () => {
    const cerrada = kushkiTransferMachine.transition(
      transferencia("initializedTransaction"),
      "query",
    );

    expect(cerrada.status).toBe("approvedTransaction");
  });

  it("el desenlace de una transferencia no aplica a otra", () => {
    // Sin esto, un token registrado como declinado contaminaría el siguiente: las pruebas
    // hardcodean tokens de 32 hexadecimales y es fácil repetir uno.
    rememberScenarioTarget(
      "kushki",
      "transfer",
      "16ea5d8beeed4d98948efb09b4d41d9f",
      "declinedTransaction",
    );

    const otra = kushkiTransferMachine.transition(
      { ...transferencia("initializedTransaction"), token: "f" + "0".repeat(31) },
      "query",
    );

    expect(otra.status).toBe("approvedTransaction");
  });
});
