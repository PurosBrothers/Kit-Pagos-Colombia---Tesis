
export interface Credentials {
  publicKey: string;
  privateKey: string;

  /**
   * Secreto con el que se firma la integridad de una transacción saliente.
   *
   * Solo Wompi lo usa, y es **distinto del secreto de eventos** con el que se
   * verifican los webhooks: uno firma lo que sale, el otro valida lo que entra.
   * Wompi los entrega juntos en el panel y es fácil intercambiarlos; cuando eso
   * pasa, el síntoma es un HTTP 422 con "La firma es inválida" y nada que
   * indique que el problema es de rotulado.
   *
   * Opcional porque las otras tres pasarelas no lo tienen y porque la API de
   * simulación no valida firmas, así que el SDK sigue siendo utilizable sin él.
   * El `WompiAdapter` solo lo exige cuando hace falta firmar de verdad.
   */
  integritySecret?: string;
}