import { KushkiChargeResponse, KushkiTransferStatusResponse } from "../gateways/kushki/types";
import {
  MercadoPagoOrderResponse,
  MercadoPagoPaymentResponse,
} from "../gateways/mercadopago/types";
import { RapydCheckout, RapydPayment } from "../gateways/rapyd/types";
import { WompiTransaction } from "../gateways/wompi/types";
import { clearScenarioMarks } from "./ScenarioMarks";
import { clearScenarioTargets } from "../state/scenarioTarget";
import { TransactionStore } from "./TransactionStore";

/**
 * Los almacenes del simulador: uno por pasarela, y en Rapyd uno por recurso.
 *
 * Son instancias separadas y no un `Map` compartido porque el estado que guarda cada
 * pasarela es de otra forma. Con un almacén común, cada lectura terminaba en una
 * conversión forzada —`findById(id) as WompiTransaction | undefined`— que el
 * compilador no podía verificar y que era la razón por la que el tipo del almacén era
 * `unknown` (issue #124).
 *
 * Rapyd tiene dos porque el checkout y el pago son recursos distintos con identificadores
 * distintos: el checkout nace con `checkout_status: "NEW"` y el pago en `null`, y es la
 * visita a la página de pago la que crea el pago. El SDK también los distingue por
 * prefijo para elegir la ruta de consulta, así que confundirlos no es un detalle
 * interno: es el comportamiento de la pasarela real.
 *
 * Se exportan los tres en vez de uno solo para que cada ruta importe el suyo y quede
 * claro qué estado está leyendo. Las instancias se comparten igual que antes: Node.js
 * cachea los módulos ES, así que cualquier archivo que importe una de estas obtiene la
 * misma instancia sin necesidad de un patrón Singleton explícito.
 */
export const wompiTransactions = new TransactionStore<WompiTransaction>();

export const rapydPayments = new TransactionStore<RapydPayment>();

export const rapydCheckouts = new TransactionStore<RapydCheckout>();

/**
 * Mercado Pago tiene dos almacenes porque cobra por dos APIs distintas: un pago con
 * tarjeta va por `POST /payments` y una orden de PSE va por `POST /orders`. La API de
 * pagos devuelve `424` para un método de PSE, así que no son dos rutas del mismo recurso
 * sino dos recursos que no se pueden pedir por la misma vía.
 */
export const mercadopagoPayments = new TransactionStore<MercadoPagoPaymentResponse>();

export const mercadopagoOrders = new TransactionStore<MercadoPagoOrderResponse>();

/**
 * Kushki también tiene dos, y por la razón que el `architecture-log.md` documenta en el
 * punto 48: el token de una transferencia son 32 hexadecimales y el ticket de un cobro con
 * tarjeta son 18. No se pueden distinguir leyendo el valor, así que van en almacenes
 * separados y cada ruta reconoce el identificador por su forma.
 */
export const kushkiCharges = new TransactionStore<KushkiChargeResponse>();

export const kushkiTransfers = new TransactionStore<KushkiTransferStatusResponse>();

/**
 * Deja el simulador como recién arrancado.
 *
 * Lo usan los ganchos `beforeEach` / `afterEach` de las pruebas. Borra las transacciones
 * y las marcas auxiliares de los escenarios, porque las dos son estado del simulador y
 * olvidar una de las dos hace que una prueba dependa del orden en que corren las demás.
 */
export function resetSimulatorState(): void {
  wompiTransactions.clear();
  rapydPayments.clear();
  rapydCheckouts.clear();
  mercadopagoPayments.clear();
  mercadopagoOrders.clear();
  kushkiCharges.clear();
  kushkiTransfers.clear();
  clearScenarioMarks();
  clearScenarioTargets();
}