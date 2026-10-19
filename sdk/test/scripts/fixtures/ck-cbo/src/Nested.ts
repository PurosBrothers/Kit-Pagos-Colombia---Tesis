import { Credentials, ResolvedCredentials } from "./types";

/**
 * CBO 1: la firma nombra solo a `ResolvedCredentials`. `Credentials` aparece en el cuerpo, que
 * CBO no mira, y no debe contarse por estar contenido en el otro nombre.
 */
export class Nested {
  keyOf(resolved: ResolvedCredentials): string {
    const credentials: Credentials = resolved.credentials;
    return credentials.key;
  }
}
