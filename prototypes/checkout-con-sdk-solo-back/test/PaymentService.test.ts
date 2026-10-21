import { Gateway, KitPagos } from "kit-pagos-colombia";
import { PaymentService } from "../src/payments/PaymentService";
import { resolveConfig } from "../src/config";

describe("PaymentService (SDK en Backend)", () => {
  const config = resolveConfig();
  let service: PaymentService;

  beforeEach(() => {
    service = new PaymentService(config);
  });

  describe("parseGateway", () => {
    it("normaliza nombres de pasarelas válidas", () => {
      expect(service.parseGateway("wompi")).toBe(Gateway.WOMPI);
      expect(service.parseGateway("MERCADOPAGO")).toBe(Gateway.MERCADOPAGO);
      expect(service.parseGateway("kushki")).toBe(Gateway.KUSHKI);
      expect(service.parseGateway("rapyd")).toBe(Gateway.RAPYD);
    });

    it("lanza error si la pasarela no está soportada", () => {
      expect(() => service.parseGateway("STRIPE")).toThrow("Pasarela no soportada: 'STRIPE'");
    });
  });

  describe("getSdk", () => {
    it("instancia KitPagos para cada pasarela", () => {
      const sdkWompi = service.getSdk(Gateway.WOMPI);
      expect(sdkWompi).toBeInstanceOf(KitPagos);

      const sdkMp = service.getSdk(Gateway.MERCADOPAGO);
      expect(sdkMp).toBeInstanceOf(KitPagos);
    });
  });

  describe("listPseBanks", () => {
    it("delega a KitPagos.getPseBanks()", async () => {
      const mockBanks = [{ code: "1022", name: "BANCO UNION" }];
      const mockSdk = {
        getPseBanks: jest.fn().mockResolvedValue(mockBanks),
      };
      jest.spyOn(service, "getSdk").mockReturnValue(mockSdk as any);

      const result = await service.listPseBanks("WOMPI");
      expect(mockSdk.getPseBanks).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("BANCO UNION");
    });
  });

  describe("createPayment", () => {
    it("procesa pago con tarjeta aprobada", async () => {
      const mockTx = {
        getStatus: () => "APPROVED",
        isApproved: () => true,
        isPending: () => false,
        gatewayTransactionId: { value: "tx-123" },
        rawStatus: "APPROVED",
        rejectionReason: undefined,
      };

      const mockSdk = {
        createPayment: jest.fn().mockResolvedValue({
          outcome: "TRANSACTION",
          transaction: mockTx,
        }),
      };
      jest.spyOn(service, "getSdk").mockReturnValue(mockSdk as any);

      const res = await service.createPayment({
        gateway: "WOMPI",
        orderReference: "MATE-001",
        amountInPesos: 45000,
        returnUrl: "http://localhost:4200/retorno",
        payer: {
          fullName: "Juan Mate",
          email: "juan@mate.com",
          documentType: "CC",
          documentNumber: "123456",
          phone: "3001234567",
        },
        method: {
          type: "CARD",
          cardToken: "tok_test_abc123",
          installments: 1,
        },
      });

      expect(res.outcome).toBe("APPROVED");
      expect(res.transactionId).toBe("tx-123");
      expect(res.isApproved).toBe(true);
    });

    it("procesa pago con redirección requerida (PSE)", async () => {
      const mockSdk = {
        createPayment: jest.fn().mockResolvedValue({
          outcome: "REDIRECT_REQUIRED",
          redirect: {
            redirectUrl: "https://banco.pse.com.co/login",
            gatewayTransactionId: { value: "pse-tx-456" },
            rawStatus: "PENDING",
          },
        }),
      };
      jest.spyOn(service, "getSdk").mockReturnValue(mockSdk as any);

      const res = await service.createPayment({
        gateway: "WOMPI",
        orderReference: "MATE-002",
        amountInPesos: 60000,
        returnUrl: "http://localhost:4200/retorno",
        payer: {
          fullName: "Ana Yerba",
          email: "ana@yerba.com",
          documentType: "CC",
          documentNumber: "654321",
          phone: "3109876543",
        },
        method: {
          type: "PSE",
          bankCode: "1022",
          personType: "NATURAL",
        },
      });

      expect(res.outcome).toBe("REDIRECT_REQUIRED");
      expect(res.redirectUrl).toBe("https://banco.pse.com.co/login");
      expect(res.transactionId).toBe("pse-tx-456");
      expect(res.isPending).toBe(true);
    });
  });

  describe("getPaymentStatus", () => {
    it("delega a KitPagos.getPaymentStatus()", async () => {
      const mockTx = {
        getStatus: () => "APPROVED",
        isApproved: () => true,
        isPending: () => false,
        isFinal: () => true,
        gatewayTransactionId: { value: "tx-789" },
        rawStatus: "PAID",
      };

      const mockSdk = {
        getPaymentStatus: jest.fn().mockResolvedValue(mockTx),
      };
      jest.spyOn(service, "getSdk").mockReturnValue(mockSdk as any);

      const res = await service.getPaymentStatus("WOMPI", "tx-789");
      expect(mockSdk.getPaymentStatus).toHaveBeenCalledWith("tx-789");
      expect(res.status).toBe("APPROVED");
      expect(res.isFinal).toBe(true);
    });
  });

  describe("validateWebhook", () => {
    it("delega a KitPagos.validateWebhook()", () => {
      const mockEvent = {
        gatewayTransactionId: "tx-webhook-1",
        newStatus: "APPROVED",
        eventType: "transaction.updated",
      };

      const mockSdk = {
        validateWebhook: jest.fn().mockReturnValue(mockEvent),
      };
      jest.spyOn(service, "getSdk").mockReturnValue(mockSdk as any);

      const event = service.validateWebhook("WOMPI", "{}", { "x-signature": "sig" });
      expect(event).toBe(mockEvent);
      expect(mockSdk.validateWebhook).toHaveBeenCalled();
    });
  });
});
