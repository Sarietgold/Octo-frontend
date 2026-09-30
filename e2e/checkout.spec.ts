import { test, expect } from "@playwright/test";

test.describe("Public Checkout Page End-to-End (Issue #380)", () => {
  test("1. Not found state when payment link does not exist", async ({ page }) => {
    page.route("**/v1/pay/invalid-slug", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 404,
          message: "Payment link not found",
        }),
      });
    });

    await page.goto("/pay/invalid-slug");
    await expect(page.locator("text=Link not found")).toBeVisible();
    await expect(
      page.locator("text=This payment link doesn't exist or is no longer active."),
    ).toBeVisible();
  });

  test("2. Form state and transition to Pay state, plus Back-and-Edit", async ({ page }) => {
    let intentCreated = false;

    page.route("**/v1/pay/coffee-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            id: "link-1",
            slug: "coffee-link",
            name: "Acme Coffee",
            description: "Freshly roasted beans",
            amount_usdc_stroops: 5000000, // $0.50
            redirect_url: null,
            active: true,
          },
        }),
      });
    });

    page.route("**/v1/pay/coffee-link/intent", async (route) => {
      intentCreated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            payment_id: "pay-intent-101",
            deposit_address: "GDEPOSITADDRESS1234567890STETNET",
            amount_usdc_stroops: 5000000,
            status: "pending",
            expires_at: null,
          },
        }),
      });
    });

    page.route("**/v1/pay/coffee-link/payments/pay-intent-101", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            status: "pending",
            transaction_id: null,
            expected_usdc_stroops: 5000000,
            received_usdc_stroops: null,
          },
        }),
      });
    });

    await page.goto("/pay/coffee-link");

    // Form state verification
    await expect(page.locator("text=Pay Acme Coffee")).toBeVisible();
    await expect(page.locator("text=$0.5")).toBeVisible();

    // Fill form and continue to Pay state
    await page.fill("#payer-name", "John Doe");
    await page.fill('input[type="email"]', "john@example.com");
    await page.click('button[type="submit"]:has-text("Continue")');

    // Pay state verification
    await expect(page.locator("text=Wallet Transfer")).toBeVisible();
    await expect(page.locator("text=GDEPOSITADDRESS1234567890STETNET")).toBeVisible();
    expect(intentCreated).toBe(true);

    // Back-and-edit state verification
    await page.click('button:has-text("‹ Back")');
    await expect(page.locator("#payer-name")).toHaveValue("John Doe");

    // Edit form and re-submit
    await page.fill("#payer-name", "John Smith");
    await page.click('button[type="submit"]:has-text("Continue")');
    await expect(page.locator("text=Wallet Transfer")).toBeVisible();
  });

  test("3. Confirmed state and HTTPS-only redirect validation", async ({ page }) => {
    page.route("**/v1/pay/https-redirect-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            id: "link-2",
            slug: "https-redirect-link",
            name: "Secure Store",
            description: "Product purchase",
            amount_usdc_stroops: 10000000, // $1.00
            redirect_url: "https://merchant-store.example.com/receipt",
            active: true,
          },
        }),
      });
    });

    page.route("**/v1/pay/https-redirect-link/intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            payment_id: "pay-intent-202",
            deposit_address: "GDEPOSITADDRESSSECURESTORE",
            amount_usdc_stroops: 10000000,
            status: "pending",
            expires_at: null,
          },
        }),
      });
    });

    page.route("**/v1/pay/https-redirect-link/payments/pay-intent-202", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            status: "confirmed",
            transaction_id: "tx-secure-999",
            expected_usdc_stroops: 10000000,
            received_usdc_stroops: 10000000,
          },
        }),
      });
    });

    await page.goto("/pay/https-redirect-link");
    await page.fill("#payer-name", "Alice");
    await page.fill('input[type="email"]', "alice@example.com");
    await page.click('button[type="submit"]:has-text("Continue")');

    // Trigger payment status check
    await page.click('button:has-text("I\'ve sent the payment — check now")');
    await expect(page.locator("text=Payment received")).toBeVisible();
    await expect(page.locator("text=Redirecting you back…")).toBeVisible();
  });

  test("4. Non-HTTPS redirect URLs are safely blocked", async ({ page }) => {
    page.route("**/v1/pay/http-redirect-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            id: "link-3",
            slug: "http-redirect-link",
            name: "Insecure Store",
            description: "Product purchase",
            amount_usdc_stroops: 10000000,
            redirect_url: "http://insecure-merchant.example.com/receipt",
            active: true,
          },
        }),
      });
    });

    page.route("**/v1/pay/http-redirect-link/intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            payment_id: "pay-intent-303",
            deposit_address: "GDEPOSITADDRESSINSECURESTORE",
            amount_usdc_stroops: 10000000,
            status: "pending",
            expires_at: null,
          },
        }),
      });
    });

    page.route("**/v1/pay/http-redirect-link/payments/pay-intent-303", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            status: "confirmed",
            transaction_id: "tx-insecure-888",
            expected_usdc_stroops: 10000000,
            received_usdc_stroops: 10000000,
          },
        }),
      });
    });

    await page.goto("/pay/http-redirect-link");
    await page.fill("#payer-name", "Bob");
    await page.fill('input[type="email"]', "bob@example.com");
    await page.click('button[type="submit"]:has-text("Continue")');

    await page.click('button:has-text("I\'ve sent the payment — check now")');
    await expect(page.locator("text=Payment received")).toBeVisible();
    // Confirmed page stays open because http: redirect was blocked by protocol check
    await expect(page).toHaveURL(/\/pay\/http-redirect-link/);
  });

  test("5. Expired checkout state", async ({ page }) => {
    page.route("**/v1/pay/expired-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            id: "link-4",
            slug: "expired-link",
            name: "Time Limited Sale",
            description: "Offer",
            amount_usdc_stroops: 2000000,
            redirect_url: null,
            active: true,
          },
        }),
      });
    });

    page.route("**/v1/pay/expired-link/intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            payment_id: "pay-intent-404",
            deposit_address: "GDEPOSITADDRESSEXPIRED",
            amount_usdc_stroops: 2000000,
            status: "pending",
            expires_at: new Date(Date.now() - 10000).toISOString(),
          },
        }),
      });
    });

    page.route("**/v1/pay/expired-link/payments/pay-intent-404", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            status: "expired",
            transaction_id: null,
            expected_usdc_stroops: 2000000,
            received_usdc_stroops: null,
          },
        }),
      });
    });

    await page.goto("/pay/expired-link");
    await page.fill("#payer-name", "Charlie");
    await page.fill('input[type="email"]', "charlie@example.com");
    await page.click('button[type="submit"]:has-text("Continue")');

    await page.click('button:has-text("I\'ve sent the payment — check now")');
    await expect(page.locator("text=Payment window expired")).toBeVisible();
    await expect(
      page.locator("text=This payment wasn't completed in time. Go back and start again."),
    ).toBeVisible();
  });

  test("6. Underpaid checkout state", async ({ page }) => {
    page.route("**/v1/pay/underpaid-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            id: "link-5",
            slug: "underpaid-link",
            name: "Digital Art",
            description: "NFT Art",
            amount_usdc_stroops: 50000000, // $5.00
            redirect_url: null,
            active: true,
          },
        }),
      });
    });

    page.route("**/v1/pay/underpaid-link/intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            payment_id: "pay-intent-505",
            deposit_address: "GDEPOSITADDRESSUNDERPAID",
            amount_usdc_stroops: 50000000,
            status: "pending",
            expires_at: null,
          },
        }),
      });
    });

    page.route("**/v1/pay/underpaid-link/payments/pay-intent-505", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            status: "underpaid",
            transaction_id: "tx-partial-111",
            expected_usdc_stroops: 50000000,
            received_usdc_stroops: 20000000, // $2.00
          },
        }),
      });
    });

    await page.goto("/pay/underpaid-link");
    await page.fill("#payer-name", "David");
    await page.fill('input[type="email"]', "david@example.com");
    await page.click('button[type="submit"]:has-text("Continue")');

    await page.click('button:has-text("I\'ve sent the payment — check now")');
    await expect(page.locator("text=Amount too low")).toBeVisible();
    await expect(
      page.locator("text=You sent $2, but $5 was expected."),
    ).toBeVisible();
  });

  test("7. Overpaid checkout state", async ({ page }) => {
    page.route("**/v1/pay/overpaid-link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            id: "link-6",
            slug: "overpaid-link",
            name: "Donation",
            description: "Charity Fund",
            amount_usdc_stroops: 10000000, // $1.00
            redirect_url: null,
            active: true,
          },
        }),
      });
    });

    page.route("**/v1/pay/overpaid-link/intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            payment_id: "pay-intent-606",
            deposit_address: "GDEPOSITADDRESSOVERPAID",
            amount_usdc_stroops: 10000000,
            status: "pending",
            expires_at: null,
          },
        }),
      });
    });

    page.route("**/v1/pay/overpaid-link/payments/pay-intent-606", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            status: "overpaid",
            transaction_id: "tx-extra-222",
            expected_usdc_stroops: 10000000,
            received_usdc_stroops: 20000000, // $2.00
          },
        }),
      });
    });

    await page.goto("/pay/overpaid-link");
    await page.fill("#payer-name", "Eve");
    await page.fill('input[type="email"]', "eve@example.com");
    await page.click('button[type="submit"]:has-text("Continue")');

    await page.click('button:has-text("I\'ve sent the payment — check now")');
    await expect(page.locator("text=Amount too high")).toBeVisible();
    await expect(
      page.locator("text=You sent $2, but only $1 was expected."),
    ).toBeVisible();
  });
});
