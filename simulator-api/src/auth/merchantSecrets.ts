import { Gateway } from "kit-pagos-colombia";
import { CredentialResolver } from "./CredentialResolver";

/*
 * El simulador es una sola cuenta de comercio por pasarela (decisión del 7 de octubre de 2026,
 * punto 86 del `architecture-log.md`). Verifica las firmas entrantes con el secreto del perfil
 * del servidor y, si no hay perfil, con estos valores por omisión.
 *
 * No son secretos: están publicados en `examples/README.md` y en `.env.example` para que
 * cualquiera pueda firmar contra un simulador sin configurar. Un despliegue que no quiera
 * aceptarlos configura su propio perfil.
 */

/** Secreto de integridad de Wompi cuando el perfil no trae `WOMPI_INTEGRITY_SECRET`. */
export const DEFAULT_WOMPI_INTEGRITY_SECRET = "test_integrity_kit_pagos_simulator";

/** `secret_key` de Rapyd cuando el perfil no trae `RAPYD_API_SECRET_KEY`. */
export const DEFAULT_RAPYD_SECRET_KEY = "rapyd_secret_kit_pagos_simulator";

/**
 * El secreto con el que el simulador verifica la firma de integridad de Wompi.
 *
 * Sale de `getServerCredentials()`, que solo devuelve el perfil si también están las dos llaves:
 * un `WOMPI_INTEGRITY_SECRET` suelto, sin `WOMPI_PUBLIC_KEY` y `WOMPI_PRIVATE_KEY`, no cuenta.
 */
export function wompiIntegritySecret(resolver: CredentialResolver): string {
  return resolver.getServerCredentials(Gateway.WOMPI)?.integritySecret ?? DEFAULT_WOMPI_INTEGRITY_SECRET;
}

/**
 * La `secret_key` con la que el simulador recalcula la firma de Rapyd. El `access_key` de la
 * petición no la cambia: entra en la cadena firmada, pero el secreto es siempre el del perfil.
 */
export function rapydSecretKey(resolver: CredentialResolver): string {
  return resolver.getServerCredentials(Gateway.RAPYD)?.privateKey ?? DEFAULT_RAPYD_SECRET_KEY;
}
