/**
 * End-to-end example of a simulated Wompi payment (issue #31, updated in issue #55).
 *
 * This file is written from the perspective of an external developer:
 * it lives outside the SDK package and imports it by its public name, just as
 * if it had been installed with `npm install kit-pagos-colombia`. It does not
 * use relative paths into `sdk/src` on purpose, because the goal is not to
 * test internal code but to demonstrate that the public surface of the package
 * is sufficient to integrate a complete payment.
 *
 * Prerequisite to run it: the Simulation API must be up on port 3000.
 * See the README in this folder.
 */
import {
  KitPagos,
  Gateway,
  Amount,
  Currency,
  OrderReference,
  Payer,
  KitPagosError,
  KitPagosErrorCode,
  type SDKOptions,
} from "kit-pagos-colombia";

/** Base URL of the Wompi mock exposed by the Simulation API. This, along with
 * the keys, should live in an external configuration file such as a .env. */
const SIMULATOR_WOMPI_URL = "http://localhost:3000/v1/sim/wompi/transactions";

/**
 * Step 1: configure the SDK.
 *
 * This is the only decision a merchant needs to make: which gateway to use and
 * with which credentials. `baseUrl` points to the simulator; in production it
 * is omitted and each Adapter uses its gateway's real endpoint. The credentials
 * in this example are fictional because the mock does not authenticate, but
 * they travel the same path as real ones.
 */
const options: SDKOptions = {
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_ejemplo_no_real",
      privateKey: "prv_test_ejemplo_no_real",
    },
  },
  baseUrl: SIMULATOR_WOMPI_URL,
};

async function main(): Promise<void> {
  const kitPagos = new KitPagos(options);

  console.log("=== Kit Pagos Colombia — simulated Wompi payment example ===\n");
  console.log(`Active gateway: ${Gateway.WOMPI}`);
  console.log(`Endpoint: ${SIMULATOR_WOMPI_URL}\n`);

  /**
   * Step 2: describe the payment using domain vocabulary.
   *
   * No native Wompi fields like `amount_in_cents` are written here. Value
   * objects that validate in their own constructor are used instead: an amount
   * with more than two decimals, a non-ISO 4217 currency or a payer without
   * an email will fail here, before any network request exists.
   *
   * The amount is written as a string, not a number. It is the only type that
   * preserves scale: `new Amount("150000.00")` still reads as "150000.00",
   * while `150000.00` in JavaScript is indistinguishable from `150000`. That
   * difference matters because Rapyd computes the request signature over the
   * serialized body, where "19.90" and "19.9" are not the same.
   */
  const request = {
    amount: new Amount("150000.00"),
    currency: new Currency("COP"),
    orderReference: new OrderReference(`ORDER-${Date.now()}`),
    payer: new Payer({
      email: "jaime.pavlich@example.com",
      fullName: "Jaime Pavlich",
    }),
  };

  console.log("Payment request:");
  console.log(`  Amount:      ${request.amount.getValue()} ${request.currency.getCode()}`);
  // What the Adapter will send to Wompi. Printed to show that the conversion
  // to cents happens in the infrastructure layer, not written by the merchant.
  console.log(`  In cents:    ${request.amount.toMinorUnits(request.currency)} (what Wompi receives)`);
  console.log(`  Reference:   ${request.orderReference.getValue()}`);
  console.log(`  Payer:       ${request.payer.email}\n`);

  /**
   * Step 3: create the payment.
   *
   * A single call. Internally the SDK resolves the active gateway, obtains its
   * credentials, builds the Wompi Adapter, translates the value objects to the
   * native format, makes the HTTP request and normalizes the response. None of
   * that leaks out here.
   */
  const transaction = await kitPagos.createPayment(request);

  console.log("Transaction created:");
  console.log(`  Gateway ID:         ${transaction.gatewayTransactionId.value}`);
  console.log(`  Source gateway:     ${transaction.gatewayTransactionId.gateway}`);
  console.log(`  Normalized status:  ${transaction.getStatus()}`);
  console.log(`  Native status:      ${transaction.rawStatus}`);
  console.log(`  Amount:             ${transaction.amount.getValue()} ${transaction.currency.getCode()}`);
  console.log(`  Reference:          ${transaction.orderReference.getValue()}`);
  console.log(`  Payer:              ${transaction.payer.email}`);
  console.log(`  Approved:           ${transaction.isApproved()}`);
  console.log(`  Final state:        ${transaction.isFinal()}\n`);

  /**
   * Step 4: query the payment status.
   *
   * Now that the simulator remembers created transactions (issue #55), this
   * query returns the same normalized transaction. The id passed is the native
   * identifier returned by Wompi when the payment was created.
   */
  console.log("Querying transaction status...");
  try {
    const consulted = await kitPagos.getPaymentStatus(
      transaction.gatewayTransactionId.value,
    );
    console.log(`  Queried ID:      ${consulted.gatewayTransactionId.value}`);
    console.log(`  Queried status:  ${consulted.getStatus()}`);
    console.log(`  Approved:        ${consulted.isApproved()}\n`);
  } catch (error) {
    if (error instanceof KitPagosError && error.code === KitPagosErrorCode.RESOURCE_NOT_FOUND) {
      console.log(`  Transaction not found. Error code: ${error.code}`);
      console.log(`  Detail: ${error.message}`);
    } else {
      throw error;
    }
  }

  console.log("=== End of example ===");
}

main().catch((error: unknown) => {
  // The only expected failure when running this is that the Simulation API is
  // not up. Translated to a concrete instruction instead of a raw stack trace.
  if (error instanceof KitPagosError && error.code === KitPagosErrorCode.CONNECTION_FAILED) {
    console.error("\nCould not connect to the Simulation API.");
    console.error("Start it in another terminal and run the example again:\n");
    console.error("  cd simulator-api && npm run dev\n");
    process.exit(1);
  }

  console.error("\nThe example failed unexpectedly:");
  console.error(error);
  process.exit(1);
});