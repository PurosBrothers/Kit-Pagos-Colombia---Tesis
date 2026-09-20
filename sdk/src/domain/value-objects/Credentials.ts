
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
   * `422 "Firma de integridad requerida no enviada"`. Consultar el estado no lo necesita,
   * porque esa llamada no lleva firma, y por eso el campo sigue siendo opcional en el tipo:
   * un comercio que solo consulte estados en Wompi no tiene por qué configurarlo. Lo que
   * el `WompiAdapter` sí hace desde el issue #92 es **exigirlo al cobrar**, en vez de dejar
   * que la transacción salga sin firma y que Wompi devuelva ese 422.
   */
  integritySecret?: string;

  /**
   * Secreto con el que la pasarela firma los webhooks que manda.
   *
   * Es un valor **distinto de la llave de API** en tres de las cuatro pasarelas, y ese
   * es todo el motivo por el que este campo existe. Hasta el issue #92 el SDK usaba
   * `privateKey` como secreto de firma, con lo cual **no podía verificar un webhook real
   * de Wompi, Mercado Pago ni Kushki**: solo el de Rapyd, que es la única que reutiliza su
   * llave, y el del simulador, que firmaba con el mismo valor porque lo escribimos nosotros.
   * El comercio quedaba en un callejón: poner el secreto de eventos en `privateKey` le
   * rompía la autenticación de la API, y dejarlo bien le rompía los webhooks.
   *
   * Dónde lo saca el comercio, que cada pasarela lo llama distinto:
   *
   * | Pasarela | Llave de API (`privateKey`) | Este campo |
   * | --- | --- | --- |
   * | Wompi | `prv_...` | "Secreto de eventos", que se genera aparte en el panel |
   * | Mercado Pago | access token `APP_USR-...` | clave secreta de webhooks del panel |
   * | Kushki | Private Merchant ID | "Webhook signature ID" de la consola |
   * | Rapyd | `secret_key` | el mismo `secret_key`, así que se puede omitir |
   *
   * Es opcional y `validateWebhook()` cae a `privateKey` cuando falta, por dos razones que
   * no son la misma: en Rapyd el respaldo es **correcto**, porque los dos valores coinciden
   * de verdad; en las otras tres es solo compatibilidad hacia atrás con el código escrito
   * antes de que el campo existiera, y ahí el respaldo va a fallar la verificación contra la
   * pasarela real. Si estás verificando webhooks de Wompi, Mercado Pago o Kushki en
   * producción, este campo no es opcional en la práctica.
   *
   * Ojo con confundirlo con `integritySecret` de Wompi, que es el otro secreto de la misma
   * pasarela: **uno firma lo que sale y el otro valida lo que entra.** Wompi los entrega
   * juntos en el panel, intercambiarlos es fácil, y el síntoma no dice cuál es el problema.
   */
  webhookSecret?: string;
}