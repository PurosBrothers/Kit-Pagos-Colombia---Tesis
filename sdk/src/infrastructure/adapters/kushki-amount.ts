import { TaxBreakdown } from "../../domain/value-objects/TaxBreakdown";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * El monto de Kushki, que no es un total sino sus partes.
 *
 * Kushki es la única de las cuatro que no recibe un importe: recibe
 * `subtotalIva0`, `subtotalIva`, `iva` e `ice` por separado, y los suma del lado
 * de ella. Eso obliga a descomponer, y descomponer mal significa cobrar mal.
 *
 * ## Por qué esto salió del adaptador
 *
 * Estaba escrito dentro de `KushkiAdapter`, primero inline en `createPayment()` y
 * después como dos métodos privados. Al entrar Transfer In —que necesita el mismo
 * desglose que el cobro con tarjeta— esos métodos pasaron a aparecer en firmas, y
 * `TaxBreakdown` se sumó al acoplamiento de la clase: CBO 7 contra un umbral de 5.
 *
 * Como funciones de módulo el desglose no le cuesta acoplamiento ni complejidad a
 * ninguna clase, que es la misma razón por la que existen `rapyd-signature.ts` y
 * `payload-utils.ts` (`architecture-log.md`, punto 34). Y de paso queda probable sin
 * montar una petición HTTP.
 */

/**
 * Resuelve el desglose tributario del cobro y verifica que cuadre con el monto.
 *
 * Cuando el comercio no informa el desglose, **el monto completo se trata como
 * exento**. Es deliberado y no un descuido: el dominio no modela todavía las reglas
 * tributarias colombianas, e inventar un IVA sería peor que no calcularlo, porque el
 * error quedaría escondido dentro de un cobro que parece correcto.
 *
 * La verificación de que las partes sumen el total no es defensiva: un desglose que
 * no cuadra hace que Kushki cobre un importe distinto del que el comercio pidió, y
 * eso el comercio lo descubre conciliando, no cobrando.
 */
export function resolveTaxBreakdown(request: CreatePaymentRequest): TaxBreakdown {
  const taxBreakdown =
    request.taxBreakdown ??
    TaxBreakdown.exempt(request.amount, request.currency);

  if (!taxBreakdown.getTotal().equals(request.amount)) {
    throw new Error("Kushki tax breakdown does not match the payment amount");
  }

  return taxBreakdown;
}

/**
 * Arma el objeto `amount` nativo de Kushki.
 *
 * Los componentes van en **pesos nominales**, no en centavos: 50.000 COP se
 * representa como `50000`, no `5000000`.
 */
export function buildKushkiAmount(
  request: CreatePaymentRequest,
  taxBreakdown: TaxBreakdown,
): Record<string, unknown> {
  return {
    subtotalIva0: Number(taxBreakdown.subtotalIva0.getValue()),
    subtotalIva: Number(taxBreakdown.subtotalIva.getValue()),
    iva: Number(taxBreakdown.iva.getValue()),
    ice: Number(taxBreakdown.ice.getValue()),
    currency: request.currency.getCode(),
  };
}
