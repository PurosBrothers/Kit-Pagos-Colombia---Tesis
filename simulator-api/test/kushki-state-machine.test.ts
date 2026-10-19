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

function charge(
  status: KushkiChargeResponse["details"]["transactionStatus"],
): KushkiChargeResponse {
  return {
    ticketNumber: "a263b3997a5b446985",
    transactionReference: "adb294b7-a13b-480b-8c63-8a6641b31d8d",
    details: {
      transactionStatus: status,
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

function transfer(
  status: KushkiTransferStatusResponse["status"],
): KushkiTransferStatusResponse {
  return {
    status: status,
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

describe("Kushki card charge table", () => {
  it.each([["APPROVAL"], ["DECLINED"], ["INITIALIZED"]] as const)(
    "a charge in %s does not move again when queried",
    (status) => {
      // El criterio 1 del issue. `DECLINED` tiene que quedarse en `DECLINED`: si tuviera
      // transición, la consulta lo movería a `APPROVAL` y un cobro rechazado se reportaría
      // como cobrado. `INITIALIZED` tampoco se mueve: un cobro creado pendiente se consulta
      // pendiente, y no hay fuente de cómo termina.
      const final = charge(status);

      expect(kushkiChargeMachine.transition(final, "query")).toBe(final);
      expect(kushkiChargeMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it("reads and writes the status in details and not at the root", () => {
    // La forma medida contra la API UAT: el estado vive en `details.transactionStatus`, en
    // camelCase, mientras que el `ticketNumber` sí está en la raíz. Si la máquina leyera
    // `transaction_status` en la raíz, el normalizador del SDK no encontraría el estado
    // y el cobro se reportaría sin resolver.
    expect(kushkiChargeMachine.statusOf(charge("INITIALIZED"))).toBe("INITIALIZED");
  });

  it("does not mutate the charge it receives", () => {
    const original = charge("INITIALIZED");
    const copy = structuredClone(original);

    kushkiChargeMachine.transition(original, "query");

    expect(original).toEqual(copy);
    expect(original.details.transactionStatus).toBe("INITIALIZED");
  });
});

describe("Kushki transfer table", () => {
  it("the issued token starts at requestedToken", () => {
    // La primera transición no la dispara nada: se queda donde nació. El avance real lo
    // hace `init`, que es lo medido —"pasa a initializedTransaction al iniciarla"—.
    const issued = transfer("requestedToken");

    expect(kushkiTransferMachine.transition(issued, "query")).toBe(issued);
    expect(kushkiTransferMachine.canTransition(issued, "query")).toBe(false);
  });

  it("init takes requestedToken to initializedTransaction", () => {
    const initiated = kushkiTransferMachine.transition(
      transfer("requestedToken"),
      "pay",
    );

    expect(initiated.status).toBe("initializedTransaction");
    expect(kushkiTransferMachine.canTransition(transfer("requestedToken"), "pay")).toBe(
      true,
    );
  });

  it("the query closes the already initiated transfer", () => {
    const closed = kushkiTransferMachine.transition(
      transfer("initializedTransaction"),
      "query",
    );

    expect(closed.status).toBe("approvedTransaction");
  });

  it("an initiated transfer does not advance with a request that is not a query", () => {
    // Transición no permitida: el segundo pago ya ocurrió, es el paso de `init`.
    const initiated = transfer("initializedTransaction");

    expect(kushkiTransferMachine.transition(initiated, "pay")).toBe(initiated);
  });

  it.each([["approvedTransaction"], ["declinedTransaction"]] as const)(
    "a transfer in %s does not move again when queried",
    (status) => {
      // El criterio 1 del issue: una transferencia aprobada se consulta como aprobada.
      const final = transfer(status);

      expect(kushkiTransferMachine.transition(final, "query")).toBe(final);
      expect(kushkiTransferMachine.canTransition(final, "query")).toBe(false);
    },
  );

  it("keeps the token, the amount and the merchant reference", () => {
    const closed = kushkiTransferMachine.transition(
      transfer("initializedTransaction"),
      "query",
    );

    // El token es el dato con el que se consultó, así que tiene que seguir siendo el mismo.
    expect(closed.token).toBe("16ea5d8beeed4d98948efb09b4d41d9f");
    expect(closed.paymentDescription).toBe("ORD-KUSHKI-PSE-9");
    expect(closed.amount.subtotalIva0).toBe(35000);
    expect(closed.callbackUrl).toBe("https://comercio.example.com/retorno");
    expect(closed.bankId).toBe("007");
  });

  it("does not mutate the transfer it receives", () => {
    const original = transfer("initializedTransaction");
    const copy = structuredClone(original);

    kushkiTransferMachine.transition(original, "query");

    expect(original).toEqual(copy);
    expect(original.status).toBe("initializedTransaction");
  });
});
describe("the outcome registered by the scenario", () => {
  beforeEach(() => {
    resetSimulatorState();
  });

  afterEach(() => {
    resetSimulatorState();
  });

  it("the table uses the registered status instead of the default target", () => {
    // Es lo que hace alcanzable `declinedTransaction`: sin escenario registrado, la
    // transición iba siempre a `approvedTransaction` y el rechazo no se podía pedir.
    const token = "16ea5d8beeed4d98948efb09b4d41d9f";

    rememberScenarioTarget("kushki", "transfer", token, "declinedTransaction");

    const closed = kushkiTransferMachine.transition(
      transfer("initializedTransaction"),
      "query",
    );

    expect(closed.status).toBe("declinedTransaction");
  });

  it("without a registered scenario the transition goes to approved", () => {
    const closed = kushkiTransferMachine.transition(
      transfer("initializedTransaction"),
      "query",
    );

    expect(closed.status).toBe("approvedTransaction");
  });

  it("with pending registered it returns the same transfer", () => {
    // El escenario PENDING registra el estado de origen como destino. La misma referencia
    // es lo que le dice a la ruta que no hay nada que guardar.
    const token = "16ea5d8beeed4d98948efb09b4d41d9f";
    rememberScenarioTarget("kushki", "transfer", token, "initializedTransaction");
    const initiated = transfer("initializedTransaction");

    expect(kushkiTransferMachine.transition(initiated, "query")).toBe(initiated);
  });

  it("fails if the registered target is not declared in the table", () => {
    // `expiredTransaction` es un estado real de Kushki, pero solo de México: la tabla no
    // lo declara. Caer al destino por defecto lo convertiría en una transferencia aprobada.
    const token = "16ea5d8beeed4d98948efb09b4d41d9f";
    rememberScenarioTarget("kushki", "transfer", token, "expiredTransaction");

    expect(() =>
      kushkiTransferMachine.transition(transfer("initializedTransaction"), "query"),
    ).toThrow("'expiredTransaction' registrado para kushki/transfer no está declarado");
  });

  it("the outcome of one transfer does not apply to another", () => {
    // Sin esto, un token registrado como declinado contaminaría el siguiente: las pruebas
    // hardcodean tokens de 32 hexadecimales y es fácil repetir uno.
    rememberScenarioTarget(
      "kushki",
      "transfer",
      "16ea5d8beeed4d98948efb09b4d41d9f",
      "declinedTransaction",
    );

    const other = kushkiTransferMachine.transition(
      { ...transfer("initializedTransaction"), token: "f" + "0".repeat(31) },
      "query",
    );

    expect(other.status).toBe("approvedTransaction");
  });
});
