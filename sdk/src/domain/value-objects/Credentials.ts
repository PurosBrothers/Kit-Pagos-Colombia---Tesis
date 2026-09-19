
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
   * **Obligatorio para cobrar con Wompi**, aunque el tipo lo declare opcional porque las
   * otras tres pasarelas no lo tienen. Antes decía que era opcional "porque la API de
   * simulación no valida firmas, así que el SDK sigue siendo utilizable sin él": medirlo
   * mostró que eso solo valía contra el simulador. Contra `sandbox.wompi.co`, tanto un cobro
   * con tarjeta como un PSE sin el campo `signature` responden
   * `422 "Firma de integridad requerida no enviada"`. El `WompiAdapter` lo exige al crear un
   * pago, con un error que nombra el dato y dónde se consigue; consultar el estado no lo
   * necesita, porque esa llamada no lleva firma.
   */
  integritySecret?: string;
}