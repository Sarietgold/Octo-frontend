// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PayPage from "./page";
import * as paymentLinksApi from "@/lib/payment-links";

// Mock canvas-confetti so celebrate() does not fail during tests.
vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

// Mock freighter-api for wallet connect button tests.
vi.mock("@stellar/freighter-api", () => ({
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

describe("Public Checkout Page (E2E States)", () => {
  const mockSlug = "test-checkout-slug";

  function makeParams(slug: string = mockSlug) {
    return {
      then(onFulfill: (val: { slug: string }) => void) {
        onFulfill({ slug });
      },
    } as unknown as Promise<{ slug: string }>;
  }

  const mockFixedLink: paymentLinksApi.PublicPaymentLink = {
    id: "link-123",
    slug: mockSlug,
    name: "Acme Corp Store",
    description: "Payment for order #1001",
    amount_usdc_stroops: 10000000, // 1 USDC ($1)
    image_url: null,
    redirect_url: "https://merchant.example.com/checkout/success",
    active: true,
  };

  const mockVariableLink: paymentLinksApi.PublicPaymentLink = {
    ...mockFixedLink,
    amount_usdc_stroops: null,
  };

  const mockIntent: paymentLinksApi.PaymentIntent = {
    payment_id: "pay-intent-999",
    deposit_address: "GC5H3X3Q777777777777777777777777777777777777777777777777",
    amount_usdc_stroops: 10000000,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Helper to render PayPage and advance fake timer past MIN_LOADING_MS (700ms).
  async function renderPayPage(link: paymentLinksApi.PublicPaymentLink = mockFixedLink) {
    vi.spyOn(paymentLinksApi, "getPublicPaymentLink").mockResolvedValue(link);
    render(<PayPage params={makeParams()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // Pass MIN_LOADING_MS (700ms)
    });
  }

  it("1. Loading state: displays spinner while fetching payment link details", async () => {
    vi.spyOn(paymentLinksApi, "getPublicPaymentLink").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockFixedLink), 2000))
    );

    render(<PayPage params={makeParams()} />);
    expect(document.querySelector(".octo-spinner")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
  });

  it("2. Not-found state: displays error message when payment link is invalid", async () => {
    vi.spyOn(paymentLinksApi, "getPublicPaymentLink").mockRejectedValue(new Error("Link not found"));

    render(<PayPage params={makeParams()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText("Link not found")).toBeInTheDocument();
    expect(screen.getByText(/doesn't exist or is no longer active/i)).toBeInTheDocument();
  });

  it("3. Form state (Fixed Amount): renders fixed pricing and user inputs", async () => {
    await renderPayPage(mockFixedLink);

    expect(screen.getByText("Pay Acme Corp Store")).toBeInTheDocument();
    expect(screen.getByText("$1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Full name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
  });

  it("4. Form state (Variable Amount): allows custom payment amount input", async () => {
    await renderPayPage(mockVariableLink);

    expect(screen.getByLabelText("Enter Amount")).toBeInTheDocument();
  });

  it("5. Form validation: blocks submission with empty or invalid email", async () => {
    await renderPayPage(mockFixedLink);

    const submitBtn = screen.getByRole("button", { name: /continue/i });
    await act(async () => {
      fireEvent.submit(submitBtn.closest("form")!);
    });

    expect(screen.getByText("Enter your name and email address.")).toBeInTheDocument();

    // Fill invalid email.
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Alice Payer" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "not-an-email" } });
    await act(async () => {
      fireEvent.submit(submitBtn.closest("form")!);
    });

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("6. Form submission transitions to Pay state", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "pending",
      transaction_id: null,
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: null,
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Alice Payer" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "alice@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(paymentLinksApi.createPaymentIntent).toHaveBeenCalledWith(mockSlug, {
      payerName: "Alice Payer",
      payerEmail: "alice@example.com",
      amountUsdcStroops: 10000000,
    });

    expect(screen.getByText("Payment Method")).toBeInTheDocument();
    expect(screen.getByText(mockIntent.deposit_address)).toBeInTheDocument();
  });

  it("7. Pay state check payment now button: displays pending status notice", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "pending",
      transaction_id: null,
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: null,
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Bob Payer" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "bob@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText("I've sent the payment — check now")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("I've sent the payment — check now"));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Not received yet — deposits can take a little while/i)).toBeInTheDocument();
  });

  it("8. Confirmed state & HTTPS Redirect: redirects after payment confirmation", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "confirmed",
      transaction_id: "tx-hash-12345",
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: 10000000,
    });

    const originalLocation = window.location;
    const hrefSetter = vi.fn();
    // @ts-expect-error mocking window.location for redirect verification
    delete window.location;
    // @ts-expect-error mocking window.location for redirect verification
    window.location = { href: "" };
    Object.defineProperty(window.location, "href", {
      set: hrefSetter,
      get: () => "",
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Charlie" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "charlie@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByText("Payment received")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(hrefSetter).toHaveBeenCalledWith(
      "https://merchant.example.com/checkout/success?status=success&payment_id=pay-intent-999&slug=test-checkout-slug"
    );

    window.location = originalLocation;
  });

  it("9. HTTPS Redirect Security: rejects non-HTTPS redirect URLs", async () => {
    const insecureLink: paymentLinksApi.PublicPaymentLink = {
      ...mockFixedLink,
      redirect_url: "http://attacker.example.com/malicious",
    };

    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "confirmed",
      transaction_id: "tx-hash-12345",
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: 10000000,
    });

    const originalLocation = window.location;
    const hrefSetter = vi.fn();
    // @ts-expect-error mocking window.location
    delete window.location;
    // @ts-expect-error mocking window.location
    window.location = { href: "" };
    Object.defineProperty(window.location, "href", {
      set: hrefSetter,
      get: () => "",
    });

    await renderPayPage(insecureLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Dave" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "dave@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByText("Payment received")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // Non-HTTPS redirect must NOT be set on window.location.href.
    expect(hrefSetter).not.toHaveBeenCalled();

    window.location = originalLocation;
  });

  it("10. Expired state: renders mismatch banner for expired payment intents", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "expired",
      transaction_id: null,
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: null,
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Eve" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "eve@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByText("Payment window expired")).toBeInTheDocument();
    expect(screen.getByText(/This payment wasn't completed in time/i)).toBeInTheDocument();
  });

  it("11. Underpaid state: renders mismatch banner when received amount is below expected", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "underpaid",
      transaction_id: "tx-underpaid-1",
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: 5000000, // $0.50
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Frank" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "frank@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByText("Amount too low")).toBeInTheDocument();
    expect(screen.getByText(/You sent \$0\.5, but \$1 was expected/i)).toBeInTheDocument();
  });

  it("12. Overpaid state: renders mismatch banner when received amount exceeds expected", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "overpaid",
      transaction_id: "tx-overpaid-1",
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: 20000000, // $2.00
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Grace" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "grace@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByText("Amount too high")).toBeInTheDocument();
    expect(screen.getByText(/You sent \$2, but only \$1 was expected/i)).toBeInTheDocument();
  });

  it("13. Back-and-edit flow: clicking Back from Pay or Mismatch returns to Form state", async () => {
    vi.spyOn(paymentLinksApi, "createPaymentIntent").mockResolvedValue(mockIntent);
    vi.spyOn(paymentLinksApi, "getPaymentStatus").mockResolvedValue({
      status: "expired",
      transaction_id: null,
      expected_usdc_stroops: 10000000,
      received_usdc_stroops: null,
    });

    await renderPayPage(mockFixedLink);

    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Heidi" } });
    fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "heidi@example.com" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });

    expect(screen.getByText("Payment window expired")).toBeInTheDocument();

    // Click Back on Mismatch banner.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /‹ Back/i }));
    });

    expect(screen.getByPlaceholderText("Full name")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("Full name") as HTMLInputElement).value).toBe("Heidi");
  });
});
