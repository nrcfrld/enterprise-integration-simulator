import { createHmac } from "node:crypto";

const baseURL = process.env.MARKETPLACE_BASE_URL ?? "http://127.0.0.1:18080";
const clientID = required("MARKETPLACE_CLIENT_ID");
const secret = required("MARKETPLACE_CLIENT_SECRET");
const path = "/api/shopee/v1/products?page_no=1&page_size=10";
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = createHmac("sha256", secret).update(`${clientID}/api/shopee/v1/products${timestamp}`).digest("hex");

const response = await fetch(`${baseURL}${path}`, { headers: { "X-Shopee-Partner-Id": clientID, "X-Shopee-Timestamp": timestamp, "X-Shopee-Signature": signature } });
const body = await response.text();
if (!response.ok) throw new Error(`Marketplace returned ${response.status}: ${body}`);
console.log(body);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
