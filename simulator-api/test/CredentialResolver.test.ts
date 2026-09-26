import { Gateway } from "kit-pagos-colombia";
import {
  CredentialResolver,
  MissingCredentialsError,
} from "../src/auth/CredentialResolver";

describe("CredentialResolver", () => {
  const mockServerEnv = {
    WOMPI_PUBLIC_KEY: "pub_test_wompi_server",
    WOMPI_PRIVATE_KEY: "prv_test_wompi_server",
    WOMPI_INTEGRITY_SECRET: "integrity_server_secret",
    WOMPI_EVENTS_SECRET: "events_server_secret",
    MERCADOPAGO_PUBLIC_KEY: "pub_test_mp_server",
    MERCADOPAGO_ACCESS_TOKEN: "access_token_mp_server",
    MERCADOPAGO_WEBHOOK_SECRET: "mp_webhook_secret",
    KUSHKI_PUBLIC_MERCHANT_ID: "kushki_public_merchant_server",
    KUSHKI_PRIVATE_MERCHANT_ID: "kushki_private_merchant_server",
    KUSHKI_WEBHOOK_SIGNATURE_ID: "kushki_signature_id_server",
    RAPYD_API_ACCESS_KEY: "rapyd_access_server",
    RAPYD_API_SECRET_KEY: "rapyd_secret_server",
  };

  it("resuelve credenciales desde el perfil del servidor si no se envían cabeceras", () => {
    const resolver = new CredentialResolver(mockServerEnv);

    const wompiResult = resolver.resolve(Gateway.WOMPI);
    expect(wompiResult.source).toBe("server");
    expect(wompiResult.credentials.publicKey).toBe("pub_test_wompi_server");
    expect(wompiResult.credentials.privateKey).toBe("prv_test_wompi_server");
    expect(wompiResult.credentials.integritySecret).toBe("integrity_server_secret");
    expect(wompiResult.credentials.webhookSecret).toBe("events_server_secret");

    const mpResult = resolver.resolve(Gateway.MERCADOPAGO);
    expect(mpResult.source).toBe("server");
    expect(mpResult.credentials.publicKey).toBe("pub_test_mp_server");
    expect(mpResult.credentials.privateKey).toBe("access_token_mp_server");
    expect(mpResult.credentials.webhookSecret).toBe("mp_webhook_secret");

    const kushkiResult = resolver.resolve(Gateway.KUSHKI);
    expect(kushkiResult.source).toBe("server");
    expect(kushkiResult.credentials.publicKey).toBe("kushki_public_merchant_server");
    expect(kushkiResult.credentials.privateKey).toBe("kushki_private_merchant_server");
    expect(kushkiResult.credentials.webhookSecret).toBe("kushki_signature_id_server");

    const rapydResult = resolver.resolve(Gateway.RAPYD);
    expect(rapydResult.source).toBe("server");
    expect(rapydResult.credentials.publicKey).toBe("rapyd_access_server");
    expect(rapydResult.credentials.privateKey).toBe("rapyd_secret_server");
    expect(rapydResult.credentials.webhookSecret).toBe("rapyd_secret_server");
  });

  it("prioriza las cabeceras del cliente cuando están completas", () => {
    const resolver = new CredentialResolver(mockServerEnv);

    const headers = {
      "x-gateway-public-key": "pub_client_custom",
      "x-gateway-private-key": "prv_client_custom",
      "x-gateway-integrity-secret": "custom_integrity_secret",
    };

    const result = resolver.resolve(Gateway.WOMPI, headers);
    expect(result.source).toBe("client");
    expect(result.credentials.publicKey).toBe("pub_client_custom");
    expect(result.credentials.privateKey).toBe("prv_client_custom");
    expect(result.credentials.integritySecret).toBe("custom_integrity_secret");
    // El webhookSecret siempre proviene del servidor
    expect(result.credentials.webhookSecret).toBe("events_server_secret");
  });

  it("ignora cualquier intento de enviar webhookSecret por cabecera", () => {
    const resolver = new CredentialResolver(mockServerEnv);

    const headers = {
      "x-gateway-public-key": "pub_client_custom",
      "x-gateway-private-key": "prv_client_custom",
      "x-gateway-webhook-secret": "malicious_fake_webhook_secret",
    };

    const result = resolver.resolve(Gateway.MERCADOPAGO, headers);
    expect(result.source).toBe("client");
    expect(result.credentials.publicKey).toBe("pub_client_custom");
    expect(result.credentials.privateKey).toBe("prv_client_custom");
    // Conserva el secreto del servidor y descarta el malicioso
    expect(result.credentials.webhookSecret).toBe("mp_webhook_secret");
    expect(result.credentials.webhookSecret).not.toBe("malicious_fake_webhook_secret");
  });

  it("cae al perfil del servidor si las cabeceras son incompletas", () => {
    const resolver = new CredentialResolver(mockServerEnv);

    // Solo trae public key pero no private key
    const incompleteHeaders = {
      "x-gateway-public-key": "pub_client_only",
    };

    const result = resolver.resolve(Gateway.KUSHKI, incompleteHeaders);
    expect(result.source).toBe("server");
    expect(result.credentials.publicKey).toBe("kushki_public_merchant_server");
    expect(result.credentials.privateKey).toBe("kushki_private_merchant_server");
  });

  it("lanza MissingCredentialsError si no hay credenciales en cabeceras ni en servidor", () => {
    // Entorno vacío
    const resolver = new CredentialResolver({});

    expect(() => resolver.resolve(Gateway.WOMPI)).toThrow(MissingCredentialsError);
    expect(() => resolver.resolve(Gateway.WOMPI)).toThrow(
      "Missing credentials for gateway 'wompi'. Configure server environment variables or provide x-gateway-public-key and x-gateway-private-key headers.",
    );
  });

  it("el mensaje de error no revela qué otras pasarelas sí están configuradas en el servidor", () => {
    // Servidor solo tiene credenciales para Wompi, pero se pide Kushki
    const partialServerEnv = {
      WOMPI_PUBLIC_KEY: "pub_wompi",
      WOMPI_PRIVATE_KEY: "prv_wompi",
    };
    const resolver = new CredentialResolver(partialServerEnv);

    try {
      resolver.resolve(Gateway.KUSHKI);
      fail("Debió lanzar MissingCredentialsError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MissingCredentialsError);
      const message = (err as Error).message;
      expect(message).toContain("'kushki'");
      expect(message).not.toContain("wompi");
      expect(message).not.toContain("mercadopago");
      expect(message).not.toContain("rapyd");
    }
  });
});
