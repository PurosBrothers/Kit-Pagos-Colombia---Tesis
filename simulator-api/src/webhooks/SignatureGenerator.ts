import { Credentials, Gateway } from "kit-pagos-colombia";
import { kushkiWebhook } from "./kushkiWebhook";
import { mercadoPagoWebhook } from "./mercadoPagoWebhook";
import { rapydWebhook, rapydWebhookSequence } from "./rapydWebhook";
import {
  OutgoingWebhook,
  WebhookBuilder,
  WebhookSequenceBuilder,
  WebhookSubject,
  WebhookUnavailableError,
} from "./webhookTypes";
import { wompiWebhook } from "./wompiWebhook";

export type { OutgoingWebhook, WebhookSubject, WebhookUnavailableReason } from "./webhookTypes";
export { WebhookUnavailableError } from "./webhookTypes";

/**
 * El armador de cada pasarela, con su cuerpo nativo y su firma, vive en su propio módulo
 * (`<pasarela>Webhook.ts`). Antes eran seis métodos de esta clase con los tipos de las cuatro
 * pasarelas en sus firmas, y un `switch` que los despachaba (issue #153).
 */
const WEBHOOK_BUILDERS: { readonly [G in Gateway]: WebhookBuilder<G> } = {
  [Gateway.WOMPI]: wompiWebhook,
  [Gateway.MERCADOPAGO]: mercadoPagoWebhook,
  [Gateway.KUSHKI]: kushkiWebhook,
  [Gateway.RAPYD]: rapydWebhook,
};

/**
 * Las pasarelas que mandan más de un aviso por un cambio de estado. Hoy solo Rapyd, con la
 * tarjeta pagada en su página (punto 118); las demás mandan uno.
 */
const SEQUENCE_BUILDERS: { readonly [G in Gateway]?: WebhookSequenceBuilder<G> } = {
  [Gateway.RAPYD]: rapydWebhookSequence,
};

/**
 * Arma el cuerpo nativo del webhook de un registro guardado y lo firma con los secretos del
 * perfil del servidor (issue #122, paso 7; issue #130, bloque 1).
 *
 * Los secretos salen solo de `secretsFor`, que en la app es
 * `credentialResolver.getServerCredentials`: nunca de la petición. La compatibilidad la decide
 * el verificador del SDK instalado, y las pruebas la comprueban contra
 * `POST /v1/api/webhooks/:gateway`.
 *
 * Cada pasarela documenta su cuerpo; lo que el simulador no puede saber (el `user_id` de
 * Mercado Pago, el `merchant_id` de Kushki) se omite en vez de inventarlo, y un evento sin
 * cuerpo documentado lanza `WEBHOOK_EVENT_NOT_DOCUMENTED`.
 */
export class SignatureGenerator {
  constructor(
    private readonly secretsFor: (gateway: Gateway) => Credentials | undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  generate(subject: WebhookSubject): OutgoingWebhook {
    const build = WEBHOOK_BUILDERS[subject.gateway] as WebhookBuilder<Gateway>;
    return build(subject, this.context());
  }

  /** Lo que la pasarela manda por el cambio de estado, en orden. Es lo que emite la emisión automática. */
  generateSequence(subject: WebhookSubject): OutgoingWebhook[] {
    const build = SEQUENCE_BUILDERS[subject.gateway] as WebhookSequenceBuilder<Gateway> | undefined;
    return build ? build(subject, this.context()) : [this.generate(subject)];
  }

  private context() {
    return { secret: (gateway: Gateway) => this.secret(gateway), now: () => this.clock() };
  }

  private secret(gateway: Gateway): Credentials & { webhookSecret: string } {
    const credentials = this.secretsFor(gateway);
    if (!credentials?.webhookSecret) {
      throw new WebhookUnavailableError(
        "WEBHOOK_SECRET_NOT_CONFIGURED",
        `The server profile has no webhook secret for ${gateway.toLowerCase()}.`,
      );
    }
    return { ...credentials, webhookSecret: credentials.webhookSecret };
  }
}
