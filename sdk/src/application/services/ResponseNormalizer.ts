import { Gateway } from "../../domain/value-objects/Gateway";
import { Transaction } from "../../domain/entities/Transaction";
import { TransactionStatus } from "../../domain/value-objects/TransactionStatus";
import { Amount } from "../../domain/value-objects/Amount";
import { Currency } from "../../domain/value-objects/Currency";
import { OrderReference } from "../../domain/value-objects/OrderReference";
import { Payer } from "../../domain/value-objects/Payer";
import { GatewayTransactionId } from "../../domain/value-objects/GatewayTransactionId";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

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
          throw new SdkError(
            SdkErrorCode.MALFORMED_RESPONSE,
            Gateway.WOMPI,
            rawResponse,
            "Failed to parse JSON response from Wompi"
          );
        }

        // Paso 2: Validar que la respuesta contenga el objeto data y su identificador
        const data = payload?.data as Record<string, unknown> | undefined;
        if (!data || typeof data !== "object" || !data.id) {
          throw new SdkError(
            SdkErrorCode.MALFORMED_RESPONSE,
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

        // Paso 4: Normalizar el monto (Wompi envía el dinero en centavos, acá se divide entre 100 para volverlo a la unidad mayor)
        const amountInCents = Number(data.amount_in_cents ?? 0);
        const amount = new Amount(amountInCents / 100);

        // Paso 5: Normalizar la divisa ISO 4217 (ej. 'COP')
        const currency = new Currency(String(data.currency ?? "COP"));

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

      // Los adaptadores para RAPYD, MERCADOPAGO y KUSHKI se incorporan en la Iteración 2
      case Gateway.RAPYD:
      case Gateway.MERCADOPAGO:
      case Gateway.KUSHKI:
      default:
        throw new SdkError(
          SdkErrorCode.UNSUPPORTED_OPERATION,
          gateway,
          rawResponse,
          `Gateway not supported for response normalization: ${gateway}`
        );
    }
  }
}