import { PaymentsPort } from "../checkout/PaymentsPort";
import { OrderStore } from "../orders/OrderStore";

/** Lo que reciben las rutas del checkout al registrarse. */
export interface RouteContext {
  payments: PaymentsPort;
  publicBaseUrl: string;
  orders: OrderStore;
}
