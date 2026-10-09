/**
 * Proyecto de muestra de `ck-metrics.test.ts`, fuera de las raíces que mide el SDK.
 *
 * Se llama igual que una clase de `KNOWN_EXCEPTIONS` (el `Amount` del SDK, exceptuado en
 * WMC) y pasa ese umbral con métodos de complejidad 2: WMC 23 = 1 del constructor + 11 × 2.
 * Así la única violación posible es la de WMC, y la prueba ve si la excepción del SDK se
 * filtra hacia un proyecto ajeno.
 */
export class Amount {
  constructor(private readonly value: number) {}

  isAboveOne(): boolean { if (this.value > 1) return true; return false; }
  isAboveTwo(): boolean { if (this.value > 2) return true; return false; }
  isAboveThree(): boolean { if (this.value > 3) return true; return false; }
  isAboveFour(): boolean { if (this.value > 4) return true; return false; }
  isAboveFive(): boolean { if (this.value > 5) return true; return false; }
  isAboveSix(): boolean { if (this.value > 6) return true; return false; }
  isAboveSeven(): boolean { if (this.value > 7) return true; return false; }
  isAboveEight(): boolean { if (this.value > 8) return true; return false; }
  isAboveNine(): boolean { if (this.value > 9) return true; return false; }
  isAboveTen(): boolean { if (this.value > 10) return true; return false; }
  isAboveEleven(): boolean { if (this.value > 11) return true; return false; }
}
