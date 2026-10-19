/**
 * Tipos del proyecto de muestra del conteo de CBO (`ck-metrics.test.ts`, issue #153).
 *
 * `ResolvedCredentials` contiene en su nombre a `Credentials` a propósito: con la búsqueda por
 * texto de antes, una firma que nombraba al primero contaba también al segundo.
 */
export interface Credentials {
  key: string;
}

export interface ResolvedCredentials {
  credentials: Credentials;
}

export enum Kind {
  CARD = "CARD",
}

export class Collaborator {
  run(): string {
    return "ok";
  }
}
