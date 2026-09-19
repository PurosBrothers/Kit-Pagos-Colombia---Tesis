import { randomBytes } from "node:crypto";
import {
  RapydCreateCustomerRequestBody,
  RapydCreatePaymentRequestBody,
  RapydCustomerResponse,
  RapydPayment,
  RapydPaymentMethodsResponse,
  RapydPaymentMethodType,
  RapydPaymentResponse,
  RapydResponseStatus,
} from "./types";

/**
 * Gateway Mock Factory — Rapyd (issue #52).
 *
 * Responsabilidad unica: construir el payload que replica la estructura nativa
 * de Rapyd para un escenario dado. No conoce headers ni valida el cuerpo de la
 * peticion; eso es del router. Es el mismo reparto de responsabilidades que en
 * la fabrica de Wompi.
 *
 * Alcance de este issue: solo el escenario aprobado, igual que el mock de Wompi
 * en su momento. Los escenarios de rechazo, expiracion, timeout y error de red
 * para las cuatro pasarelas son el issue #65, y agregarlos aca despues no
 * cambia nada de lo que ya existe.
 */
export class GatewayMockFactory {
  /**
   * Rapyd identifica sus pagos con el prefijo `payment_` seguido de 32
   * caracteres hexadecimales. Se replica esa forma en vez de usar `randomUUID()`
   * como el mock de Wompi, porque un identificador con guiones no se parece a
   * los que devuelve Rapyd y el objetivo del mock es que el adaptador se
   * ejercite contra algo indistinguible de la pasarela real.
   */
  private static buildPaymentId(): string {
    return `payment_${randomBytes(16).toString("hex")}`;
  }

  /** Envuelve el objeto de negocio en el sobre `{ status, data }` que Rapyd usa siempre. */
  private static wrap(data: RapydPayment): RapydPaymentResponse {
    return { status: GatewayMockFactory.buildStatus(), data };
  }

  /**
   * Respuesta de un pago aprobado.
   *
   * `status: "CLO"` con `paid: true` es lo que Rapyd devuelve para un pago
   * efectivamente cobrado. Los dos campos van juntos a proposito: `CLO` por si
   * solo no significa aprobado, y el mock no debe permitir que el adaptador
   * pase una prueba leyendo unicamente el estado.
   *
   * El monto y la divisa se reflejan tal como llegaron. Es lo que permite que
   * una prueba verifique que el SDK envio pesos y no centavos: si el adaptador
   * multiplicara por 100, el monto de vuelta seria cien veces mayor.
   */
  buildApprovedResponse(
    requestBody: RapydCreatePaymentRequestBody,
  ): RapydPaymentResponse {
    return GatewayMockFactory.wrap({
      id: GatewayMockFactory.buildPaymentId(),
      status: "CLO",
      paid: true,
      amount: requestBody.amount,
      currency_code: requestBody.currency,
      merchant_reference_id: requestBody.merchant_reference_id,
      receipt_email: requestBody.receipt_email ?? "",
      failure_code: "",
      failure_message: "",
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Respuesta de la consulta de estado de un pago existente.
   *
   * El mock no guarda estado entre peticiones, asi que reconstruye un pago
   * aprobado con el identificador consultado. Alcanza para que el
   * `RapydAdapter` ejercite su ruta de consulta de punta a punta, que es lo que
   * pide este issue. La persistencia en memoria real, que permitiria que la
   * consulta devuelva el pago tal como se creo, es el issue #55.
   */
  buildStatusResponse(paymentId: string): RapydPaymentResponse {
    return GatewayMockFactory.wrap({
      id: paymentId,
      status: "CLO",
      paid: true,
      amount: "0",
      currency_code: "COP",
      merchant_reference_id: "",
      receipt_email: "",
      failure_code: "",
      failure_message: "",
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Respuesta de `POST /v1/customers`, la primera de las dos llamadas de PSE.
   *
   * Rapyd prefija los identificadores de cliente con `cus_` y 32 caracteres
   * hexadecimales, igual que los de pago con `payment_`. Medido contra el sandbox
   * real: `cus_01f2f7ddace1fc8aa19ae9c535d7fb57`.
   */
  buildCustomerResponse(
    requestBody: RapydCreateCustomerRequestBody,
  ): RapydCustomerResponse {
    return {
      status: GatewayMockFactory.buildStatus(),
      data: {
        id: `cus_${randomBytes(16).toString("hex")}`,
        name: requestBody.name ?? "",
        email: requestBody.email ?? "",
        phone_number: requestBody.phone_number ?? "",
        created_at: Math.floor(Date.now() / 1000),
      },
    };
  }

  /**
   * Respuesta de un pago por PSE recien creado.
   *
   * Reproduce lo medido contra el sandbox real el 18 de septiembre de 2026, que se
   * separa del flujo de tarjeta en tres cosas:
   *
   * 1. `status: "ACT"` con `paid: false`, no `CLO` con `paid: true`. El pago
   *    arranco y nadie cobro nada todavia.
   * 2. `next_action: "pending_confirmation"`, que **no** es el
   *    `"3d_verification"` del flujo de tarjeta. Importa que el mock use el valor
   *    real: si usara el de 3DS, una prueba podria pasar por la razon equivocada.
   * 3. La `redirect_url` viene **en esta misma respuesta**, sin sondeo, a
   *    diferencia de Wompi. Y lleva incrustadas las dos URL de retorno del
   *    comercio como parametros, que es la unica evidencia de que el SDK las
   *    envio de verdad.
   */
  buildPseCreatedResponse(
    requestBody: RapydCreatePaymentRequestBody,
  ): RapydPaymentResponse {
    const id = GatewayMockFactory.buildPaymentId();
    const params = new URLSearchParams({ token: id });

    if (requestBody.complete_payment_url) {
      params.set("complete_payment_url", requestBody.complete_payment_url);
    }
    if (requestBody.error_payment_url) {
      params.set("error_payment_url", requestBody.error_payment_url);
    }

    return GatewayMockFactory.wrap({
      id,
      status: "ACT",
      paid: false,
      amount: requestBody.amount,
      currency_code: requestBody.currency,
      merchant_reference_id: requestBody.merchant_reference_id,
      receipt_email: requestBody.receipt_email ?? "",
      failure_code: "",
      failure_message: "",
      created_at: Math.floor(Date.now() / 1000),
      next_action: "pending_confirmation",
      redirect_url: `https://sandboxcheckout.rapyd.net/complete-bank-payment?${params.toString()}`,
      customer: typeof requestBody.customer === "string" ? requestBody.customer : "",
    });
  }

  /**
   * Catalogo de metodos de pago de Colombia, del que PSE es una parte.
   *
   * Rapyd no tiene lista de bancos: devuelve el catalogo del pais y PSE son 47
   * entradas dentro. El mock incluye cuatro de esos 47 mas un metodo que **no** es
   * PSE, a proposito: sin una entrada que haya que descartar, una prueba del filtro
   * pasaria aunque el filtro no filtrara nada.
   *
   * Los nombres son los reales medidos contra el sandbox.
   */
  buildPaymentMethodsResponse(): RapydPaymentMethodsResponse {
    const pseBanks: readonly [string, string][] = [
      ["co_pse_bancolombia_bank", "Bancolombia"],
      ["co_pse_banco_davivienda_bank", "Banco Davivienda"],
      ["co_pse_banco_de_bogota_bank", "Banco de Bogota"],
      ["co_pse_banco_av_villas_bank", "Banco AV Villas"],
    ];

    const methods: RapydPaymentMethodType[] = pseBanks.map(([type, name]) => ({
      type,
      name,
      category: "bank_redirect",
      image: "",
      country: "CO",
      payment_flow_type: "BANK_REDIRECT",
    }));

    methods.push({
      type: "co_visa_card",
      name: "Visa",
      category: "card",
      image: "",
      country: "CO",
      payment_flow_type: "",
    });

    return { status: GatewayMockFactory.buildStatus(), data: methods };
  }

  /** Sobre de exito, compartido por las tres clases de respuesta. */
  private static buildStatus(): RapydResponseStatus {
    return {
      error_code: "",
      status: "SUCCESS",
      message: "",
      response_code: "",
      operation_id: randomBytes(16).toString("hex"),
    };
  }
}
