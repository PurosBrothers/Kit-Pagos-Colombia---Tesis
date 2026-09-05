import { Gateway } from "../../domain/value-objects/Gateway";
import { Credentials } from "../../domain/value-objects/Credentials";
import { SdkError } from "../../domain/errors/SdkError";
import { SdkErrorCode } from "../../domain/value-objects/SdkErrorCode";

export interface SDKOptions {
  gateway: Gateway;
  credentials: Partial<Record<Gateway, Credentials>>;
}

export class SdkConfigurator {
  private activeGateway?: Gateway;
  private credentialsMap: Map<Gateway, Credentials> = new Map();

  configure(options: SDKOptions): void {
    const gateway = options.gateway;
    const credentials = options.credentials;
    if (!gateway || !credentials) {
      throw new SdkError(
        SdkErrorCode.INVALID_REQUEST,
        gateway,
        null,
        "Both gateway and credentials must be configured"
      );
    }
    this.activeGateway = gateway;
    this.credentialsMap.clear();

    Object.entries(credentials).forEach(([key, value]) => {
      this.credentialsMap.set(key as Gateway, value as Credentials);
    });
  }

  getActiveGateway(): Gateway {
    if (!this.activeGateway) {
      throw new Error("No active gateway has been configured");
    }
    return this.activeGateway;
  }

  getCredentials(gateway: Gateway): Credentials {
    const creds = this.credentialsMap.get(gateway);
    if (!creds) {
      throw new SdkError(
        SdkErrorCode.INVALID_CREDENTIALS,
        gateway,
        null,
        `Credentials not configured for gateway: ${gateway}`
      ); // (Cumplimiento de RF-08)
    }
    return creds;
  }
}