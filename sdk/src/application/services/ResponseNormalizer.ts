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
      case Gateway.RAPYD: {
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
            Gateway.RAPYD,
            rawResponse,
            "Failed to parse JSON response from Rapyd"
          );
        }

        // Paso 2: Rapyd envuelve todas sus respuestas en `{ status, data }`,
        // donde `status` es el resultado de la llamada de API y `data` el objeto
        // de negocio. El envoltorio siempre está presente, a diferencia de
        // Mercado Pago, que devuelve el pago en la raíz.
        const data = payload?.data as Record<string, unknown> | undefined;
        if (!data || typeof data !== "object" || !data.id) {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.RAPYD,
            rawResponse,
            "Malformed response from Rapyd gateway: missing data.id"
          );
        }

        // Paso 3: Normalizar el estado nativo de Rapyd al enum unificado.
        const rawStatus = String(data.status ?? "");
        const failureCode = String(data.failure_code ?? "");
        let status: TransactionStatus;
        switch (rawStatus.toUpperCase()) {
          case "CLO":
            // "CLO" es "cerrado", no "pagado": son dos campos distintos y hay
            // que leer los dos. Un pago cerrado sin `paid` no autoriza a decirle
            // al comercio que cobró, y por eso no se normaliza a APPROVED.
            // La combinación no está documentada, así que se degrada a ERROR en
            // vez de a DECLINED: afirmar un rechazo sería afirmar que el banco
            // respondió, y eso no se sabe.
            status = data.paid === true ? "APPROVED" : "ERROR";
            break;
          case "ACT":
            // Activo: creado y esperando que el pagador lo complete. Es el
            // estado en el que el comercio debe reintentar el polling.
            status = "PENDING";
            break;
          case "ERR":
            // Rapyd no distingue el rechazo de negocio del fallo técnico por
            // `status` (es "ERR" en ambos casos). Se aplica el mismo criterio de
            // desambiguación por prefijo de `failure_code` que ya usa
            // WebhookVerifier para el evento PAYMENT_FAILED, para que el mismo
            // pago no se normalice distinto según si llegó por webhook o por
            // consulta. Ver docs.rapyd.net/en/card-network-errors.html.
            status = failureCode.startsWith("ERROR_PROCESSING_CARD")
              ? "DECLINED"
              : "ERROR";
            break;
          case "EXP":
            status = "EXPIRED";
            break;
          case "REV":
            // Revertido por Rapyd, con el motivo en `cancel_reason`. Este código
            // resuelve el pendiente que ubiquitous-language.md dejaba abierto
            // conjeturando "CAN": el valor real que documenta Rapyd es "REV".
            status = "VOIDED";
            break;
          default:
            status = "ERROR";
            break;
        }

        // Paso 4: Normalizar la divisa. En la respuesta el campo es
        // `currency_code`, aunque en la petición de creación se llame
        // `currency`. Son nombres distintos en el contrato real de Rapyd.
        const currency = new Currency(String(data.currency_code ?? "COP"));

        // Paso 5: Normalizar el monto. Rapyd trabaja en la unidad mayor (pesos
        // con decimales), no en centavos, así que NO se usa `fromMinorUnits()`:
        // hacerlo dividiría el monto entre cien.
        //
        // Rapyd puede devolver el monto como número JSON, y en ese caso la
        // escala ya se perdió antes de llegar acá: `150000.00` es
        // indistinguible de `150000` en el parseo de JSON. No es algo que el SDK
        // pueda arreglar del lado entrante; es exactamente la razón por la que
        // sí se envía como string en la petición, donde la escala importa porque
        // participa del cálculo de la firma.
        let amount: Amount;
        try {
          const rawAmount = data.amount;
          amount = new Amount(
            typeof rawAmount === "number" ? rawAmount.toString() : String(rawAmount ?? "")
          );
        } catch (amountError) {
          throw new KitPagosError(
            KitPagosErrorCode.MALFORMED_RESPONSE,
            Gateway.RAPYD,
            rawResponse,
            `Malformed amount in Rapyd response: ${(amountError as Error).message}`
          );
        }

        // Paso 6: Normalizar la referencia de orden del comercio
        const orderReference = new OrderReference(
          String(data.merchant_reference_id || data.id)
        );

        // Paso 7: Normalizar los datos del pagador. Rapyd no expone un email de
        // pagador obligatorio como las otras tres pasarelas: lo más cercano es
        // `receipt_email`, que es opcional. Cuando viene vacío se cae a un valor
        // de relleno, igual que en la rama de Wompi.
        const receiptEmail = data.receipt_email || "customer@rapyd.net";
        const payer = new Payer({ email: String(receiptEmail) });

        // Paso 8: Normalizar el identificador nativo junto con su pasarela
        const gatewayTransactionId = new GatewayTransactionId(
          String(data.id),
          Gateway.RAPYD
        );

        // Paso 9: Construir la entidad inmutable Transaction
        return new Transaction(
          gatewayTransactionId,
          orderReference,
          amount,
          currency,
          payer,
          status,
          rawStatus
        );
      }

      // El adaptador para KUSHKI se incorpora en la Iteración 2
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