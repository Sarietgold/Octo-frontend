import { test, expect, Page } from "@playwright/test";

// Mock API routes for authentication and wallet creation.
function mockWalletCreationApi(page: Page) {
  const wallets: Array<{
    id: string;
    network: string;
    address: string;
    custody: string;
    funded: boolean;
    label: string;
    description: string;
  }> = [];

  page.route("**/v1/auth/signup", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 200,
        message: "success",
        data: {
          user_id: "user-test-123",
          email_verification_required: true,
        },
      }),
    });
  });

  page.route("**/v1/auth/verify-email", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 200,
        message: "success",
        data: {
          token: "test-auth-token-xyz",
          user: {
            id: "user-test-123",
            email: "alice@example.com",
            username: null,
          },
        },
      }),
    });
  });

  page.route("**/v1/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 200,
        message: "success",
        data: {
          id: "user-test-123",
          email: "alice@example.com",
          username: null,
        },
      }),
    });
  });

  page.route("**/v1/wallets/challenge", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 200,
        message: "success",
        data: {
          challenge: "test-challenge-nonce-12345",
        },
      }),
    });
  });

  page.route("**/v1/wallets", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: {
            data: wallets,
            next_cursor: null,
          },
        }),
      });
    } else if (method === "POST") {
      const payload = JSON.parse(route.request().postData() || "{}");
      const newWallet = {
        id: "wallet-test-456",
        network: "testnet",
        address: payload.public_key || "GABC1234567890TESTNETADDRESS",
        custody: "non-custodial",
        funded: true,
        label: payload.label || "Test Master Wallet",
        description: payload.description || "Test wallet description",
      };
      wallets.push(newWallet);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 200,
          message: "success",
          data: newWallet,
        }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe("Wallet Creation Flow (Issue #379)", () => {
  test("signup -> OTP -> dashboard -> create wallet -> recovery phrase -> dashboard & CSP check", async ({
    page,
  }) => {
    await mockWalletCreationApi(page);

    // 1. Visit signup page and verify Content-Security-Policy header presence.
    const signupResponse = await page.goto("/signup");
    expect(signupResponse?.ok()).toBeTruthy();
    const cspHeader = signupResponse?.headers()["content-security-policy"];
    expect(cspHeader).toBeDefined();

    // 2. Fill credentials on signup page.
    await page.fill('input[type="email"]', "alice@example.com");
    await page.fill('input[type="password"]', "StrongPassphrase123!");
    await page.click('button[type="submit"]');

    // 3. Verify OTP screen renders and enter 6-digit code.
    await expect(page.locator("h1")).toHaveText("Check your email");
    const otpInputs = page.locator('input[inputmode="numeric"]');
    await expect(otpInputs).toHaveCount(6);
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(String(i + 1));
    }
    await page.click('button[type="submit"]');

    // 4. Verify successful authentication redirects to dashboard.
    await page.waitForURL("**/dashboard");

    // 5. Navigate to wallet creation page.
    await page.goto("/dashboard/wallets/new");
    await expect(page.locator("h2")).toHaveText("Create a new master wallet");

    // 6. Enter wallet metadata and encryption password.
    await page.fill("#wallet-name", "Primary Master Wallet");
    await page.fill("#wallet-description", "Main business wallet for payments");
    await page.fill("#wallet-password", "quantum-galaxy-nebula-vortex-2026!");
    await page.fill('input[placeholder="Confirm password"]', "quantum-galaxy-nebula-vortex-2026!");
    await page.click('button[type="submit"]');

    // 7. Verify recovery phrase reveal UI.
    await expect(page.locator("h2")).toHaveText("Wallet created — save your recovery phrase");
    const wordElements = page.locator("ol.grid li");
    const wordCount = await wordElements.count();
    expect(wordCount).toBeGreaterThan(0);

    const words: string[] = [];
    for (let i = 0; i < wordCount; i++) {
      const text = await wordElements.nth(i).innerText();
      const word = text.replace(/^\d+\.\s*/, "").trim();
      words.push(word);
    }

    // Acknowledge saved phrase to proceed.
    await page.check('input[type="checkbox"]');
    await page.click('button:has-text("Continue to verification")');

    // 8. Confirm requested recovery phrase words.
    await expect(page.locator("h2")).toHaveText("Confirm your recovery phrase");
    const labels = page.locator('label[htmlFor^="phrase-word-"]');
    const labelCount = await labels.count();
    expect(labelCount).toBeGreaterThan(0);

    for (let i = 0; i < labelCount; i++) {
      const labelText = await labels.nth(i).innerText();
      const wordNumMatch = labelText.match(/Word #(\d+)/);
      expect(wordNumMatch).not.toBeNull();
      const wordIndex = parseInt(wordNumMatch![1], 10) - 1;
      const inputId = await labels.nth(i).getAttribute("htmlFor");
      await page.fill(`#${inputId}`, words[wordIndex]);
    }

    // Complete wallet setup and navigate back to dashboard.
    await page.click('button[type="submit"]:has-text("Go to dashboard")');
    await page.waitForURL("**/dashboard");
  });
});
