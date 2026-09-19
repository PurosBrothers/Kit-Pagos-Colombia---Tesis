import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * Armado del cuerpo de un pago de Rapyd, para los dos métodos que el adaptador cobra.
 *
 * ## Por qué esto salió del adaptador
 *
 * Al entrar PSE, `RapydAdapter` llegó a WMC 23 contra un umbral de 20: la clase
 * pasó a hacer dos secuencias distintas de llamadas, y encima el armado del cuerpo
 * —que son puras ramas de campos opcionales— seguía escrito dentro del método que
 * las orquesta. Mover el armado a funciones de módulo deja en la clase lo que
 * decide y saca lo que traduce, sin costarle acoplamiento ni complejidad a nadie
 * (`architecture-log.md`, punto 34).
 *
 * De paso resolvió una duplicación: las URL de retorno del comercio se resolvían
 * igual en el camino de tarjeta y en el de PSE, en dos copias que ya habían empezado
 * a separarse.
 */

/**
 * Agrega al cuerpo las dos URL a las que Rapyd devuelve al pagador.
 *
 * Rapyd tiene exactamente dos, para éxito y para error, y **no una tercera para el
 * caso pendiente**, a diferencia de Mercado Pago. En PSE eso importa más que en
 * tarjeta, porque se midió que Rapyd las incrusta como parámetros dentro de la
 * `redirect_url` que devuelve: son el destino real al que el banco manda al pagador
 * cuando termina, y la única evidencia observable de que el SDK las envió.
 *
 * Modifica el objeto recibido en vez de devolver uno nuevo porque los dos llamantes
 * lo están construyendo, y devolver una copia invitaría a olvidarse de asignarla.
 */
export function applyReturnUrls(
  payload: Record<string, unknown>,
  request: CreatePaymentRequest,
): void {
  if (!request.returnUrlConfig) {
    return;
  }

  const completeUrl = request.returnUrlConfig.resolveFor("APPROVED");
  const errorUrl = request.returnUrlConfig.resolveFor("DECLINED");

  if (completeUrl) {
    payload.complete_payment_url = completeUrl;
  }
  if (errorUrl) {
    payload.error_payment_url = errorUrl;
  }
}

