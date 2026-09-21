import { Transaction } from "../../../domain/entities/Transaction";

/**
 * Contrato que implementa el normalizador de cada pasarela.
 *
 * ## Por que hay una implementacion por pasarela
 *
 * Traducir la respuesta nativa de una pasarela a `Transaction` es un trabajo
 * distinto por cada una: cambian los nombres de los campos, la unidad del monto
 * (Wompi manda centavos, Rapyd y Mercado Pago pesos), la ubicacion del objeto de
 * datos (envuelto en `data` o en la raiz) y el vocabulario de estados. Lo unico
 * que comparten es la forma del resultado.
 *
 * Mientras las cuatro traducciones vivieron como ramas de un `switch` en un solo
 * metodo, agregar una pasarela significaba editar ese metodo, y su complejidad
 * ciclomatica crecia con cada una (llego a 62 con tres pasarelas implementadas).
 * Con este contrato, agregar Kushki es agregar una clase y registrarla: ninguna
 * de las traducciones existentes se toca, que es el principio abierto/cerrado
 * aplicado al punto exacto donde el SDK crece.
 *
 * Ver architecture-log.md, punto 34.
 */
export interface GatewayResponseNormalizer {
  /**
   * Traduce la respuesta nativa de la pasarela a la entidad del dominio.
   *
   * @param rawResponse Cuerpo de la respuesta, como string JSON u objeto ya
   *                    deserializado.
   * @throws KitPagosError con MALFORMED_RESPONSE si la respuesta no trae los
   *         campos minimos o el monto es ininterpretable.
   */
  normalize(rawResponse: unknown): Transaction;
}
