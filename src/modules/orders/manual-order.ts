import { z } from "zod";

const MAX_MONEY_MINOR_UNITS = BigInt("999999999999");
const moneyPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

const requiredText = (label: string, maximum: number) =>
  z.string().trim().min(1, `${label} is required.`).max(maximum, `${label} must be ${maximum} characters or fewer.`);

const optionalText = (label: string, maximum: number) =>
  z.string().trim().max(maximum, `${label} must be ${maximum} characters or fewer.`).transform((value) => value || undefined);

const optionalEmail = z.string().trim().max(254, "Email must be 254 characters or fewer.").refine(
  (value) => value === "" || z.string().email().safeParse(value).success,
  "Enter a valid email address.",
).transform((value) => value || undefined);

const money = z.string().trim().regex(moneyPattern, "Enter a valid amount with no more than 2 decimal places.").transform(normalizeMoney);

const quantity = z.string().trim().regex(/^\d+$/, "Quantity must be a positive whole number.").transform(Number).pipe(
  z.number().int().min(1, "Quantity must be at least 1.").max(100_000, "Quantity must be 100,000 or fewer."),
);

const manualOrderItemSchema = z.object({
  name: requiredText("Product title", 200),
  sku: requiredText("SKU", 100),
  quantity,
  unitPrice: money,
});

export const manualOrderSchema = z.object({
  customerName: requiredText("Customer name", 200),
  customerEmail: optionalEmail,
  customerPhone: optionalText("Phone", 50),
  recipientName: requiredText("Recipient name", 200),
  address1: requiredText("Address line 1", 300),
  address2: optionalText("Address line 2", 300),
  city: optionalText("City", 100),
  province: optionalText("State / province / region", 100),
  postalCode: optionalText("Postal / ZIP code", 30),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Enter a 2-letter country code."),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Enter a 3-letter currency code."),
  notes: optionalText("Notes", 2_000),
  items: z.array(manualOrderItemSchema).min(1, "Add at least one item.").max(100, "An order can have no more than 100 items."),
}).superRefine((value, context) => {
  if (calculateManualOrderTotal(value.items) > MAX_MONEY_MINOR_UNITS) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "The order total is too large.",
    });
  }
});

export type ManualOrderInput = z.infer<typeof manualOrderSchema>;

export type ManualOrderActionState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialManualOrderActionState: ManualOrderActionState = { status: "idle" };

export function manualOrderInputFromFormData(formData: FormData) {
  const itemNames = formData.getAll("itemName");
  const itemSkus = formData.getAll("itemSku");
  const itemQuantities = formData.getAll("itemQuantity");
  const itemUnitPrices = formData.getAll("itemUnitPrice");
  const itemCount = Math.max(itemNames.length, itemSkus.length, itemQuantities.length, itemUnitPrices.length);

  return {
    customerName: textValue(formData, "customerName"),
    customerEmail: textValue(formData, "customerEmail"),
    customerPhone: textValue(formData, "customerPhone"),
    recipientName: textValue(formData, "recipientName"),
    address1: textValue(formData, "address1"),
    address2: textValue(formData, "address2"),
    city: textValue(formData, "city"),
    province: textValue(formData, "province"),
    postalCode: textValue(formData, "postalCode"),
    countryCode: textValue(formData, "countryCode"),
    currency: textValue(formData, "currency"),
    notes: textValue(formData, "notes"),
    items: Array.from({ length: itemCount }, (_, index) => ({
      name: formText(itemNames[index]),
      sku: formText(itemSkus[index]),
      quantity: formText(itemQuantities[index]),
      unitPrice: formText(itemUnitPrices[index]),
    })),
  };
}

export function validationErrors(error: z.ZodError): Pick<ManualOrderActionState, "message" | "fieldErrors"> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return { message: "Please correct the highlighted fields.", fieldErrors };
}

export function parseMoneyToMinorUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function normalizeMoney(value: string): string {
  const minorUnits = parseMoneyToMinorUnits(value);
  const whole = minorUnits / BigInt(100);
  const fraction = (minorUnits % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function calculateManualOrderTotal(items: Array<{ quantity: number; unitPrice: string }>): bigint {
  return items.reduce((total, item) => total + BigInt(item.quantity) * parseMoneyToMinorUnits(item.unitPrice), BigInt(0));
}

export function minorUnitsToMoney(minorUnits: bigint): string {
  const whole = minorUnits / BigInt(100);
  const fraction = (minorUnits % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function generateManualOrderNumber(now = new Date(), entropy = crypto.randomUUID()): string {
  return generateInternalOrderNumber("MAN", now, entropy);
}

export function generateReplacementOrderNumber(now = new Date(), entropy = crypto.randomUUID()): string {
  return generateInternalOrderNumber("REP", now, entropy);
}

function generateInternalOrderNumber(prefix: "MAN" | "REP", now: Date, entropy: string): string {
  const date = [now.getUTCFullYear(), String(now.getUTCMonth() + 1).padStart(2, "0"), String(now.getUTCDate()).padStart(2, "0")].join("");
  const suffix = entropy.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8).padEnd(8, "0");
  return `${prefix}-${date}-${suffix}`;
}

function textValue(formData: FormData, name: string) {
  return formText(formData.get(name));
}

function formText(value: FormDataEntryValue | undefined | null) {
  return typeof value === "string" ? value : "";
}
