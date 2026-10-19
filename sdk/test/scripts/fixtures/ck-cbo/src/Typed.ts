import { Collaborator, Kind } from "./types";

/**
 * CBO 2: `Kind` solo aparece en un `typeof` y `Collaborator` solo dentro de un argumento
 * genérico. Cada uno se cuenta una vez aunque se repita.
 */
export class Typed {
  kinds(): typeof Kind {
    return Kind;
  }

  count(list: Array<Collaborator>, others: readonly Collaborator[]): number {
    return list.length + others.length;
  }
}
