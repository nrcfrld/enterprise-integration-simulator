import { expect, test } from "@playwright/test";

interface CredentialResponse {
  client_id: string;
  client_secret: string;
}

test("login, seed data, race inventory, create credential, and send a signed request", async ({ context, page }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await page.getByLabel("Email").fill("admin@example.test");
  await page.getByLabel("Password").fill("change-me-now");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const shopName = `Browser Smoke ${Date.now()}`;
  await page.getByRole("button", { name: "Open shops" }).click();
  await page.getByRole("button", { name: "+ New shop" }).click();
  await page.getByLabel("Shop name").fill(shopName);
  await page.getByLabel("Marketplace behavior").selectOption("SHOPEE_LIKE");
  await page.getByRole("button", { name: /^Create/ }).click();
  await expect(page.getByRole("status")).toContainText("shop created");

  await page.getByLabel("Current shop").selectOption({ label: shopName });
  await page.getByRole("link", { name: "Products" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset to seed" }).click();
  await expect(page.getByRole("status")).toContainText("Seed complete: 100 products and 50 orders");

  await page.getByRole("link", { name: "Orders" }).click();
  await page.getByRole("button", { name: "+ Simulate order" }).click();
  await page.getByRole("button", { name: "Mass order" }).click();
  const targetProduct = page.getByLabel("Target product");
  await expect(targetProduct).not.toHaveValue("");
  const selectedProduct = await targetProduct.locator("option:checked").textContent();
  const availableStock = Number(selectedProduct?.match(/available (\d+)/)?.[1]);
  expect(availableStock).toBeGreaterThan(0);
  await page.getByLabel("Number of orders").fill("3");
  await page.getByLabel("Concurrent workers").fill("3");
  await page.getByLabel("Quantity per order").fill(String(availableStock));
  await page.getByRole("button", { name: "Run mass simulation →" }).click();
  await expect(page.locator(".app-notice")).toContainText("1 created and 2 rejected");

  await page.getByRole("link", { name: "API Credentials" }).click();
  const newCredentialButton = page.getByRole("button", { name: "+ New credential" });
  await newCredentialButton.click();
  const createCredentialDialog = page.getByRole("dialog", { name: "Create API credential" });
  await expect(createCredentialDialog).toBeVisible();
  await expect(createCredentialDialog.getByRole("heading", { name: "Create API credential" })).toBeFocused();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await page.keyboard.press("Shift+Tab");
  await expect(createCredentialDialog.getByRole("button", { name: /^Create/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(createCredentialDialog.getByRole("button", { name: "Close form" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(createCredentialDialog).toBeHidden();
  await expect(newCredentialButton).toBeFocused();

  await newCredentialButton.click();
  const credentialResponse = page.waitForResponse(
    (response) => response.url().includes("/credentials")
      && response.request().method() === "POST"
      && response.status() === 201,
  );
  await page.getByRole("button", { name: /^Create/ }).click();
  const credential = await (await credentialResponse).json() as CredentialResponse;
  expect(credential.client_id).toMatch(/^client_/);
  expect(credential.client_secret).toMatch(/^sec_/);
  const credentialDialog = page.getByRole("dialog", { name: "Credential created" });
  await expect(credentialDialog).toContainText(credential.client_id);
  await expect(credentialDialog).toContainText(credential.client_secret);
  await expect(credentialDialog.getByRole("heading", { name: "Credential created" })).toBeFocused();
  await credentialDialog.getByRole("button", { name: "Copy Client secret" }).click();
  await expect(credentialDialog).toContainText("Copied");
  await page.keyboard.press("Escape");
  await expect(credentialDialog).toBeHidden();
  await expect(newCredentialButton).toBeFocused();

  await page.getByRole("link", { name: "API Documentation" }).click();
  await page.getByRole("button", { name: "Request simulator", exact: true }).click();
  await page.getByRole("button", { name: "Shopee-like" }).click();
  await page.getByLabel("Client ID").fill(credential.client_id);
  await page.getByLabel("Client secret").fill(credential.client_secret);
  await page.getByRole("button", { name: "Send signed request" }).click();

  const response = page.locator(".simulator-response");
  await expect(response).toContainText("200 OK");
  await expect(response).toContainText("item_id");
  await expect(response).toContainText("total_count");
});
