// Minimal iyzico client for the hosted Checkout Form (no SDK, no card data on
// our servers). Follows the official iyzipay-node implementation:
//   Authorization: IYZWSv2 base64("apiKey:<key>&randomKey:<rnd>&signature:<hex>")
//   signature = HMAC-SHA256(secretKey, randomKey + uriPath + JSON body), hex
// Responses of CF retrieve carry a signature over
//   paymentStatus:paymentId:currency:basketId:conversationId:paidPrice:price:token
// (prices without trailing zeros), which is verified before a payment counts.
import crypto from "crypto";

export const IYZICO_SANDBOX = "https://sandbox-api.iyzipay.com";
export const IYZICO_LIVE = "https://api.iyzipay.com";
export const CF_INITIALIZE_PATH = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
export const CF_RETRIEVE_PATH = "/payment/iyzipos/checkoutform/auth/ecom/detail";

export interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

/** Config from IYZICO_API_KEY / IYZICO_SECRET_KEY / IYZICO_BASE_URL (sandbox by default), or null. */
export function iyzicoConfig(env: NodeJS.ProcessEnv = process.env): IyzicoConfig | null {
  const apiKey = (env.IYZICO_API_KEY || "").trim();
  const secretKey = (env.IYZICO_SECRET_KEY || "").trim();
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey, baseUrl: (env.IYZICO_BASE_URL || IYZICO_SANDBOX).replace(/\/$/, "") };
}

export function isSandbox(cfg: IyzicoConfig): boolean {
  return /sandbox/i.test(cfg.baseUrl) || cfg.apiKey.startsWith("sandbox-");
}

/** Price as iyzico expects it in requests: "149.0", "12.5" (dot decimal, at least one decimal). */
export function formatPrice(price: string | number): string {
  const n = typeof price === "number" ? price : Number(String(price).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid price: ${price}`);
  const s = (Math.round(n * 100) / 100).toString();
  return s.includes(".") ? s : `${s}.0`;
}

/** Price as used in response signatures: trailing zeros (and a bare dot) removed. */
export function signaturePrice(v: unknown): string {
  const s = String(v ?? "");
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

export function authorizationHeader(cfg: IyzicoConfig, path: string, bodyJson: string, randomKey: string): string {
  const signature = crypto.createHmac("sha256", cfg.secretKey).update(randomKey + path + bodyJson).digest("hex");
  const params = `apiKey:${cfg.apiKey}&randomKey:${randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(params, "utf8").toString("base64")}`;
}

/** HMAC-SHA256 (hex) of the values joined with ":" — iyzico's response signature. */
export function responseSignature(values: unknown[], secretKey: string): string {
  return crypto.createHmac("sha256", secretKey).update(values.map((v) => String(v ?? "")).join(":")).digest("hex");
}

/** Verifies the signature of a Checkout Form retrieve response. */
export function verifyRetrieveSignature(r: Record<string, any>, secretKey: string): boolean {
  if (typeof r?.signature !== "string" || !r.signature) return false;
  const expected = responseSignature(
    [r.paymentStatus, r.paymentId, r.currency, r.basketId, r.conversationId, signaturePrice(r.paidPrice), signaturePrice(r.price), r.token],
    secretKey
  );
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(r.signature), "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function post(cfg: IyzicoConfig, path: string, body: Record<string, unknown>): Promise<any> {
  const json = JSON.stringify(body);
  const rnd = `${process.hrtime()[0]}${Math.random().toString(8).slice(2)}`;
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-iyzi-rnd": rnd,
      Authorization: authorizationHeader(cfg, path, json, rnd),
    },
    body: json,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: "failure", errorMessage: `iyzico HTTP ${res.status}` };
  }
}

export interface CheckoutBuyer {
  id: string;
  name: string;
  surname: string;
  email: string;
  gsmNumber: string;
  identityNumber: string;
  address: string;
  city: string;
  country: string;
  zipCode?: string | null;
  ip?: string | null;
}

export interface CheckoutInput {
  conversationId: string; // also used as basketId
  price: string; // "149.0"
  currency: string; // TRY
  callbackUrl: string;
  itemId: string;
  itemName: string;
  buyer: CheckoutBuyer;
}

/** Request body for CF initialize (one virtual basket item = the plan period). */
export function checkoutRequest(i: CheckoutInput): Record<string, unknown> {
  const contactName = `${i.buyer.name} ${i.buyer.surname}`.trim();
  const address = { contactName, city: i.buyer.city, country: i.buyer.country, address: i.buyer.address, ...(i.buyer.zipCode ? { zipCode: i.buyer.zipCode } : {}) };
  return {
    locale: "tr",
    conversationId: i.conversationId,
    price: i.price,
    paidPrice: i.price,
    currency: i.currency,
    basketId: i.conversationId,
    paymentGroup: "PRODUCT",
    callbackUrl: i.callbackUrl,
    enabledInstallments: [1],
    buyer: {
      id: i.buyer.id,
      name: i.buyer.name,
      surname: i.buyer.surname,
      gsmNumber: i.buyer.gsmNumber,
      email: i.buyer.email,
      identityNumber: i.buyer.identityNumber,
      registrationAddress: i.buyer.address,
      city: i.buyer.city,
      country: i.buyer.country,
      ...(i.buyer.zipCode ? { zipCode: i.buyer.zipCode } : {}),
      ...(i.buyer.ip ? { ip: i.buyer.ip } : {}),
    },
    shippingAddress: address,
    billingAddress: address,
    basketItems: [{ id: i.itemId, name: i.itemName, category1: "Yazılım aboneliği", itemType: "VIRTUAL", price: i.price }],
  };
}

export async function initializeCheckout(cfg: IyzicoConfig, input: CheckoutInput) {
  return post(cfg, CF_INITIALIZE_PATH, checkoutRequest(input));
}

export async function retrieveCheckout(cfg: IyzicoConfig, token: string, conversationId?: string) {
  return post(cfg, CF_RETRIEVE_PATH, { locale: "tr", ...(conversationId ? { conversationId } : {}), token });
}

/** Splits "Ad Soyad" into iyzico's name/surname (a single word goes to both). */
export function splitName(full: string): { name: string; surname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name: "-", surname: "-" };
  if (parts.length === 1) return { name: parts[0], surname: parts[0] };
  return { name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

/** Adds one billing period to a date (month or year), clamping to the month's last day. */
export function addPeriod(from: Date, period: "month" | "year"): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  if (period === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}
