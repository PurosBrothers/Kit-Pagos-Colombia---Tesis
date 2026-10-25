import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Gateway } from "kit-pagos-colombia";

export interface GatewayPublicConfig {
  gateway: string;
  name: string;
  publicKey: string;
  tokenizationUrl: string;
  supportsCard: boolean;
  supportsPse: boolean;
  isHosted: boolean;
}

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  environment: "simulator" | "sandbox";
  simulatorBaseUrl: string;
  credentials: {
    wompi: {
      publicKey: string;
      privateKey: string;
      integritySecret?: string;
      eventsSecret?: string;
    };
    mercadopago: {
      publicKey: string;
      accessToken: string;
      webhookSecret?: string;
    };
    kushki: {
      publicMerchantId: string;
      privateMerchantId: string;
      webhookSecret?: string;
    };
    rapyd: {
      accessKey: string;
      secretKey: string;
      /** La URL exacta registrada en el panel de Rapyd: entra en la firma de sus webhooks. */
      webhookUrl?: string;
    };
  };
}

/** Carga el .env de la raíz del monorepo si existe y las variables no están ya en process.env */
function loadDotenvFromWorkspace(): void {
  const envPath = path.resolve(__dirname, "..", "..", "..", ".env");
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // Si no se puede leer, continúa con los valores por defecto
  }
}

loadDotenvFromWorkspace();

export function resolveConfig(): AppConfig {
  const port = Number(process.env.PORT || 4200);
  // `localtest.me` es un dominio público que resuelve a 127.0.0.1: Mercado Pago no deja volver de un
  // PSE a `localhost`, y así el banco devuelve al comprador a esta máquina sin túnel (punto 120).
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL?.trim() || `http://localtest.me:${port}`).replace(/\/+$/, "");

  // ==========================================================================
  // CONFIGURACIÓN DE AMBIENTE:
  // - "sandbox" (POR DEFECTO): Apunta a las APIs oficiales de prueba de cada pasarela.
  // - "simulator" (EXPLÍCITO): Apunta al simulador local de la tesis (simulator-api).
  // Como A y B, no cobra en producción: la página tokeniza contra los hosts de sandbox.
  // ==========================================================================
  const environment = (process.env.KIT_PAGOS_ENVIRONMENT?.trim() || "sandbox").toLowerCase();
  if (environment !== "sandbox" && environment !== "simulator") {
    throw new Error(`KIT_PAGOS_ENVIRONMENT tiene que ser sandbox o simulator, no «${environment}».`);
  }

  // URL del simulador propio desarrollado para la tesis (simulator-api, típicamente en localhost:3000)
  const simulatorBaseUrl = process.env.SIMULATOR_SDK_BASE_URL || "http://localhost:3000";

  return {
    port,
    publicBaseUrl,
    environment,
    simulatorBaseUrl,
    // Las credenciales salen SOLO del .env (nunca embebidas en el código).
    // Si falta alguna, la pasarela responderá 401 y se verá claro en el log.
    credentials: {
      wompi: {
        publicKey: process.env.WOMPI_PUBLIC_KEY ?? "",
        privateKey: process.env.WOMPI_PRIVATE_KEY ?? "",
        integritySecret: process.env.WOMPI_INTEGRITY_SECRET,
        eventsSecret: process.env.WOMPI_EVENTS_SECRET,
      },
      mercadopago: {
        publicKey: process.env.MERCADOPAGO_PUBLIC_KEY ?? "",
        accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? "",
        webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
      },
      kushki: {
        publicMerchantId: process.env.KUSHKI_PUBLIC_MERCHANT_ID ?? "",
        privateMerchantId: process.env.KUSHKI_PRIVATE_MERCHANT_ID ?? "",
        webhookSecret: process.env.KUSHKI_WEBHOOK_SECRET,
      },
      rapyd: {
        accessKey: process.env.RAPYD_API_ACCESS_KEY ?? "",
        secretKey: process.env.RAPYD_API_SECRET_KEY ?? "",
        webhookUrl: process.env.RAPYD_WEBHOOK_URL,
      },
    },
  };
}

export function getPublicGatewayConfigs(config: AppConfig): Record<string, GatewayPublicConfig> {
  const isSim = config.environment === "simulator";
  const sim = config.simulatorBaseUrl;

  return {
    [Gateway.WOMPI]: {
      gateway: Gateway.WOMPI,
      name: "Wompi",
      publicKey: config.credentials.wompi.publicKey,
      // ENDPOINT DE TOKENIZACIÓN EN FRONTEND:
      // - Simulador de Tesis: [SIMULADOR LOCAL] ${sim}/v1/sim/wompi/tokens/cards
      // - Sandbox Oficial Wompi: [EXTERNO] https://sandbox.wompi.co/v1/tokens/cards
      tokenizationUrl: isSim ? `${sim}/v1/sim/wompi/tokens/cards` : "https://sandbox.wompi.co/v1/tokens/cards",
      supportsCard: true,
      supportsPse: true,
      isHosted: false,
    },
    [Gateway.MERCADOPAGO]: {
      gateway: Gateway.MERCADOPAGO,
      name: "Mercado Pago",
      publicKey: config.credentials.mercadopago.publicKey,
      // ENDPOINT DE TOKENIZACIÓN EN FRONTEND:
      // - Simulador de Tesis: [SIMULADOR LOCAL] ${sim}/v1/sim/mercadopago/card_tokens
      // - Sandbox Oficial Mercado Pago: [EXTERNO] https://api.mercadopago.com/v1/card_tokens
      tokenizationUrl: isSim
        ? `${sim}/v1/sim/mercadopago/card_tokens`
        : "https://api.mercadopago.com/v1/card_tokens",
      supportsCard: true,
      supportsPse: true,
      isHosted: false,
    },
    [Gateway.KUSHKI]: {
      gateway: Gateway.KUSHKI,
      name: "Kushki",
      publicKey: config.credentials.kushki.publicMerchantId,
      // ENDPOINT DE TOKENIZACIÓN EN FRONTEND:
      // - Simulador de Tesis: [SIMULADOR LOCAL] ${sim}/v1/sim/kushki/card/v1/tokens
      // - Sandbox Oficial Kushki UAT: [EXTERNO] https://api-uat.kushkipagos.com/card/v1/tokens
      tokenizationUrl: isSim
        ? `${sim}/v1/sim/kushki/card/v1/tokens`
        : "https://api-uat.kushkipagos.com/card/v1/tokens",
      supportsCard: true,
      supportsPse: true,
      isHosted: false,
    },
    [Gateway.RAPYD]: {
      gateway: Gateway.RAPYD,
      name: "Rapyd",
      publicKey: config.credentials.rapyd.accessKey,
      tokenizationUrl: "", // Rapyd no tokeniza en navegador: usa checkout alojado (Hosted Checkout)
      supportsCard: true,
      supportsPse: true,
      isHosted: true,
    },
  };
}
