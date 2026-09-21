import { Gateway } from "../../domain/value-objects/Gateway";
import { Transaction } from "../../domain/entities/Transaction";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { GatewayResponseNormalizer } from "./normalizers/GatewayResponseNormalizer";
import { WompiResponseNormalizer } from "./normalizers/WompiResponseNormalizer";
import { MercadoPagoResponseNormalizer } from "./normalizers/MercadoPagoResponseNormalizer";
import { RapydResponseNormalizer } from "./normalizers/RapydResponseNormalizer";
import { KushkiResponseNormalizer } from "./normalizers/KushkiResponseNormalizer";

/**
 * Servicio de aplicacion que traduce la respuesta nativa de cualquier pasarela a
 * la entidad Transaction del dominio.
 *
 * ## Estructura
 *
 * Esta clase es un despachador: no traduce nada por si misma, sino que delega en
 * el normalizador registrado para la pasarela recibida. La traduccion de cada
 * pasarela vive en su propia clase bajo `normalizers/`.
 *
 * Antes las cuatro traducciones eran ramas de un `switch` dentro de este metodo,
 * lo que lo dejaba en 360 lineas y complejidad ciclomatica 62. Cada pasarela
 * nueva sumaba ~120 lineas al mismo metodo. La division en una clase por
 * pasarela es lo que permite que agregar Kushki no toque codigo existente.
 * Ver architecture-log.md, punto 34.
 *
 * La firma publica `normalize(rawResponse, gateway)` se conserva intacta: los
 * adaptadores y las pruebas no notan el cambio de estructura interna.
 */
export class ResponseNormalizer {
  private readonly normalizers: Partial<Record<Gateway, GatewayResponseNormalizer>> = {
    [Gateway.WOMPI]: new WompiResponseNormalizer(),
    [Gateway.MERCADOPAGO]: new MercadoPagoResponseNormalizer(),
    [Gateway.RAPYD]: new RapydResponseNormalizer(),
    [Gateway.KUSHKI]: new KushkiResponseNormalizer(),
  };

  /**
   * Traduce la respuesta nativa de la pasarela indicada a Transaction.
   *
   * @throws KitPagosError con UNSUPPORTED_OPERATION si la pasarela no tiene
   *         normalizador registrado, o con MALFORMED_RESPONSE si la respuesta no
   *         cumple el contrato minimo de la pasarela.
   */
  normalize(rawResponse: unknown, gateway: Gateway): Transaction {
    const normalizer = this.normalizers[gateway];

    if (!normalizer) {
      throw new KitPagosError(
        KitPagosErrorCode.UNSUPPORTED_OPERATION,
        gateway,
        rawResponse,
        `Gateway not supported for response normalization: ${gateway}`,
      );
    }

    return normalizer.normalize(rawResponse);
  }
}
