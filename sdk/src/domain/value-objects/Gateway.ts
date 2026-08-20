/**
 * Identifica la pasarela de pago concreta.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) y Glosario.
 */
export type Gateway = "wompi" | "payu" | "mercadopago" | "kushki";
