import { WompiAdapter } from "./WompiAdapter";
import { MercadoPagoAdapter } from "./MercadoPagoAdapter";
import { RapydAdapter } from "./RapydAdapter";
import { KushkiAdapter } from "./KushkiAdapter";
import { PaymentMethod } from "../../domain/value-objects/PaymentMethod";
import type { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort";

/**
 * La lista de bancos de PSE, vista como una sola capacidad de las cuatro pasarelas.
 *
 * ## Por qué esta prueba existe aparte de las de cada adaptador
 *
 * Porque lo que hay que verificar no es que cada pasarela sepa leer su propia
 * respuesta —eso lo cubren las pruebas de cada módulo— sino que **las cuatro
 * produzcan la misma forma a partir de respuestas que no se parecen en nada**. Esa
 * es la afirmación que sostiene que la lista pertenece al puerto, y es del tipo que
 * se rompe callada: alguien agrega una pasarela, devuelve `{ id, label }` en vez de
 * `{ code, name }`, y el comercio que ya tenía su selector armado descubre el cambio
 * en producción.
 *
 * Las cuatro respuestas de acá son las formas nativas reales, **las cuatro medidas**
 * contra las APIs de sandbox el 18 de septiembre de 2026. La de Kushki se midió al
 * final, cuando aparecieron las credenciales de API, y midiéndola apareció algo que
 * la referencia no menciona: su lista encabeza con un elemento que no es un banco.
 */
describe("la lista de bancos de PSE, en las cuatro pasarelas", () => {
  const originalFetch = global.fetch;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function mockJson(body: unknown): jest.Mock {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    global.fetch = mockFetch;
    return mockFetch;
  }

  /**
   * Cada entrada es una pasarela con su forma nativa y la ruta donde la publica. Las
   * cuatro rutas son distintas, y dos de ellas ni siquiera son listas de bancos:
   * Mercado Pago las anida dentro de su catálogo de métodos de pago y Rapyd las
   * mezcla con los otros 50 métodos de Colombia.
   */
  const gateways: readonly {
    nombre: string;
    build: (baseUrl: string) => PaymentGatewayPort;
    respuesta: unknown;
    ruta: string;
    esperado: readonly { code: string; name: string }[];
  }[] = [
    {
      nombre: "Wompi",
      build: (baseUrl) => new WompiAdapter(baseUrl),
      ruta: "https://api.example.com/pse/financial_institutions",
      respuesta: {
        data: [
          {
            financial_institution_code: "1",
            financial_institution_name: "Banco que aprueba",
          },
          {
            financial_institution_code: "2",
            financial_institution_name: "Banco que declina",
          },
        ],
        meta: {},
      },
      esperado: [
        { code: "1", name: "Banco que aprueba" },
        { code: "2", name: "Banco que declina" },
      ],
    },
    {
      nombre: "Mercado Pago",
      build: (baseUrl) => new MercadoPagoAdapter(baseUrl),
      ruta: "https://api.example.com/payment_methods",
      respuesta: [
        { id: "master", name: "Mastercard", payment_type_id: "credit_card" },
        {
          id: "pse",
          name: "PSE",
          payment_type_id: "bank_transfer",
          financial_institutions: [
            { id: "1007", description: "Bancolombia" },
            { id: "1051", description: "Davivienda" },
          ],
        },
      ],
      esperado: [
        { code: "1007", name: "Bancolombia" },
        { code: "1051", name: "Davivienda" },
      ],
    },
    {
      nombre: "Rapyd",
      build: (baseUrl) => new RapydAdapter(baseUrl),
      ruta: "https://api.example.com/payment_methods/country?country=CO",
      respuesta: {
        status: { status: "SUCCESS" },
        data: [
          { type: "co_pse_bancolombia_bank", name: "Bancolombia" },
          { type: "co_visa_card", name: "Visa" },
        ],
      },
      esperado: [{ code: "co_pse_bancolombia_bank", name: "Bancolombia" }],
    },
    {
      nombre: "Kushki",
      build: (baseUrl) => new KushkiAdapter(baseUrl),
      ruta: "https://api.example.com/transfer/v1/bankList",
      /*
       * El primer elemento es el que devuelve la API real, y no es un banco: es el
       * texto de relleno de un `<select>`. Está acá porque la respuesta nativa lo
       * trae, y es lo que hace que esta prueba verifique algo: sin él, que las cuatro
       * listas sean "solo bancos" sería cierto por casualidad.
       */
      respuesta: [
        { code: "0", name: "A continuación seleccione su banco" },
        { code: "001", name: "Bancolombia" },
        { code: "007", name: "Davivienda" },
      ],
      esperado: [
        { code: "001", name: "Bancolombia" },
        { code: "007", name: "Davivienda" },
      ],
    },
  ];

  it.each(gateways.map((g) => [g.nombre, g] as const))(
    "%s devuelve la forma unificada desde su forma nativa",
    async (_nombre, gateway) => {
      mockJson(gateway.respuesta);

      const banks = await gateway.build("https://api.example.com").getPseBanks();

      expect(banks).toEqual(gateway.esperado);
    },
  );

  it.each(gateways.map((g) => [g.nombre, g] as const))(
    "%s pide la lista en su ruta nativa",
    async (_nombre, gateway) => {
      const mockFetch = mockJson(gateway.respuesta);

      await gateway.build("https://api.example.com").getPseBanks();

      expect(mockFetch.mock.calls[0][0]).toBe(gateway.ruta);
    },
  );

  /**
   * El cierre del círculo: el código que sale de la lista tiene que entrar en
   * `PaymentMethod.pse()` sin transformarlo. Es lo que hace que un `bankCode` opaco
   * sea aceptable en vez de una fuga de la abstracción — el comercio nunca lo
   * interpreta, solo lo devuelve.
   */
  it.each(gateways.map((g) => [g.nombre, g] as const))(
    "los códigos de %s se pueden usar directamente en PaymentMethod.pse()",
    async (_nombre, gateway) => {
      mockJson(gateway.respuesta);

      const banks = await gateway.build("https://api.example.com").getPseBanks();

      expect(banks.length).toBeGreaterThan(0);
      for (const bank of banks) {
        expect(() => PaymentMethod.pse({ bankCode: bank.code })).not.toThrow();
      }
    },
  );

  /**
   * Un nombre vacío es cosmético, pero un código vacío produce una opción que falla
   * al elegirla, y el pagador se entera en el peor momento. Las cuatro descartan esas
   * entradas en vez de pasarlas al selector del comercio.
   */
  it.each(gateways.map((g) => [g.nombre, g] as const))(
    "%s nunca devuelve un banco sin código",
    async (_nombre, gateway) => {
      mockJson(gateway.respuesta);

      const banks = await gateway.build("https://api.example.com").getPseBanks();

      for (const bank of banks) {
        expect(bank.code).not.toBe("");
        expect(bank.name).not.toBe("");
      }
    },
  );
});
