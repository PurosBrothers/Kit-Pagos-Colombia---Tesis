import { Gateway } from "../../domain/value-objects/Gateway"
import { Credentials } from "../../domain/value-objects/Credentials"

export interface SDKOptions {
  gateway: Gateway;
  credentials: Record<string, Credentials>;
}

export class SdkConfigurator {
  configure (_options:SDKOptions): void {
    throw new Error("aun no esta implementado");
  }
  getActiveGateway(): Gateway {
    throw new Error("aun no esta implementado");
  }

  getCredentials(_gateway: Gateway): Credentials {
    throw new Error("aun no esta implementado");
  }
}