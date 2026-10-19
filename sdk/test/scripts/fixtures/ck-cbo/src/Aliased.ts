import { Collaborator as Helper } from "./types";

/** CBO 1: el colaborador entra con alias, y la firma dice `Helper`, no `Collaborator`. */
export class Aliased {
  constructor(private readonly helper: Helper) {}

  run(): string {
    return this.helper.run();
  }
}
