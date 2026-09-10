import { Gateway } from "../../domain/value-objects/Gateway";
import { Transaction } from "../../domain/entities/Transaction";
import { TransactionStatus } from "../../domain/value-objects/TransactionStatus";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../domain/value-objects/GatewayTransactionId";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";

export class ResponseNormalizer {
  normalize(rawResponse: unknown, gateway: Gateway): Transaction {
    switch (gateway) {
      case Gateway.WOMPI: {
        // Paso 1: Parsear el payload crudo si viene como string JSON
        let payload: Record<string, unknown>;
        try {
          payload =
            typeof rawResponse === "string"
              ? (JSON.parse(rawResponse) as Record<string, unknown>)
              : (rawResponse as Record<string, unknown>);
        } catch {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.WOMPI,
            rawResponse,
            "Failed to parse JSON response from Wompi"
          );
        }

        // Paso 2: Validar que la respuesta contenga el objeto data y su identificador
        const data = payload?.data as Record<string, unknown> | undefined;
        if (!data || typeof data !== "object" || !data.id) {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.WOMPI,
            rawResponse,
            "Malformed response from Wompi gateway: missing data.id"
          );
        }

        // Paso 3: Normalizar el estado nativo de Wompi al enum unificado TransactionStatus
        const rawStatus = String(data.status ?? "");
        let status: TransactionStatus;
        switch (rawStatus.toUpperCase()) {
          case "APPROVED":
            status = "APPROVED";
            break;
          case "DECLINED":
            status = "DECLINED";
            break;
          case "VOIDED":
            status = "VOIDED";
            break;
          case "PENDING":
            status = "PENDING";
            break;
          case "ERROR":
          default:
            status = "ERROR";
            break;
        }

        // Paso 4: Normalizar la divisa ISO 4217 (ej. 'COP'). Va antes del monto
        // porque es la divisa la que sabe cuántos decimales tiene, y por lo
        // tanto dónde cae el punto decimal al reconstruir el monto.
        const currency = new Currency(String(data.currency ?? "COP"));

        // Paso 5: Normalizar el monto. Wompi lo envía en centavos, y se
        // reconstruye insertando el punto decimal en vez de dividir entre 100:
        // 1990 centavos deben volver como "19.90", y una división daría "19.9",
        // que es un monto distinto del que el comercio cobró.
        let amount: Amount;
        try {
          amount = Amount.fromMinorUnits(
            String(data.amount_in_cents ?? 0),
            currency
          );
        } catch (amountError) {
          // Un monto que no se puede interpretar es una respuesta malformada, y
          // debe llegar al comercio como error tipado igual que los pasos 1 y 2,
          // no como el Error nativo que lanza el objeto de valor.
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.WOMPI,
            rawResponse,
            `Malformed amount in Wompi response: ${(amountError as Error).message}`
          );
        }

        // Paso 6: Normalizar la referencia de orden del comercio
        const orderReference = new OrderReference(String(data.reference ?? data.id));

        // Paso 7: Normalizar los datos del pagador (garantizando el email obligatorio)
        const customerEmail =
          data.customer_email ?? payload.customer_email ?? "customer@wompi.co";
        const payer = new Payer({ email: String(customerEmail) });

        // Paso 8: Normalizar el identificador nativo combinándolo con el Gateway de origen
        const gatewayTransactionId = new GatewayTransactionId(
          String(data.id),
          Gateway.WOMPI
        );

        // Paso 9: Extraer código de autorización bancario si viene presente
        const authorizationCode = data.authorization_code
          ? String(data.authorization_code)
          : undefined;

        // Paso 10: Construir y retornar la entidad inmutable Transaction con todos sus objetos de valor
        return new Transaction(
          gatewayTransactionId,
          orderReference,
          amount,
          currency,
          payer,
          status,
          rawStatus,
          undefined,
          authorizationCode
        );
      }
      case Gateway.MERCADOPAGO: {
        // Paso 1: Parsear el payload si viene como string JSON
        let payload: Record<string, unknown>;
        try {
          payload =
            typeof rawResponse === "string"
              ? JSON.parse(rawResponse)
              : (rawResponse as Record<string, unknown>);
        } catch {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.MERCADOPAGO,
            rawResponse,
            "Failed to parse JSON response from Mercado Pago"
          );
        }

        // Paso 2: Mercado Pago devuelve un objeto plano en la raíz (o en data si fuera un mock)
        const data = (payload?.data ?? payload) as Record<string, unknown> | undefined;
        if (!data || typeof data !== "object" || !data.id) {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.MERCADOPAGO,
            rawResponse,
            "Malformed response from Mercado Pago gateway: missing id"
          );
        }

        // Paso 3: Normalizar el estado nativo (en minúsculas) al enum unificado TransactionStatus.
        // Se preserva rawStatus exactamente como llegó para auditoría.
        const rawStatus = String(data.status ?? "");
        let status: TransactionStatus;
        switch (rawStatus.toLowerCase()) {
          case "approved":
            status = "APPROVED";
            break;
          case "rejected":
            status = "DECLINED";
            break;
          case "pending":
          case "in_process":
            status = "PENDING";
            break;
          case "cancelled":
            status = "VOIDED";
            break;
          default:
            status = "ERROR";
            break;
        }

        // Paso 4: Normalizar la divisa ISO 4217 (Mercado Pago usa 'currency_id', ej. 'COP')
        const currency = new Currency(String(data.currency_id ?? "COP"));

        // Paso 5: Normalizar el monto. Mercado Pago entrega 'transaction_amount' en pesos
        // con decimales, no en centavos. Se construye Amount directamente sin toMinorUnits.
        let amount: Amount;
        try {
          const rawAmount = data.transaction_amount;
          const amountStr =
            typeof rawAmount === "number"
              ? rawAmount.toString()
              : String(rawAmount ?? "");
          amount = new Amount(amountStr);
        } catch (amountError) {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.MERCADOPAGO,
            rawResponse,
            `Malformed amount in Mercado Pago response: ${(amountError as Error).message}`
          );
        }

        // Paso 6: Normalizar la referencia de orden (external_reference o description)
        const orderReference = new OrderReference(
          String(data.external_reference ?? data.description ?? data.id)
        );

        // Paso 7: Normalizar los datos del pagador
        const payerData = data.payer as Record<string, unknown> | undefined;
        const customerEmail = payerData?.email ?? "customer@mercadopago.com";
        const payer = new Payer({ email: String(customerEmail) });

        // Paso 8: Normalizar el identificador nativo combinándolo con Gateway.MERCADOPAGO
        const gatewayTransactionId = new GatewayTransactionId(
          String(data.id),
          Gateway.MERCADOPAGO
        );

        // Paso 9: Construir y retornar la entidad inmutable Transaction
        return new Transaction(
          gatewayTransactionId,
          orderReference,
          amount,
          currency,
          payer,
          status,
          rawStatus,
          undefined,
          undefined
        );
      }
      // Los adaptadores para RAPYD y KUSHKI se incorporan en la Iteración 2
      case Gateway.RAPYD:
      case Gateway.KUSHKI:
      default:
        throw new KitPagosError(
          KitPagosErrorCode.UNSUPPORTED_OPERATION,
          gateway,
          rawResponse,
          `Gateway not supported for response normalization: ${gateway}`
        );
    }
  }
}