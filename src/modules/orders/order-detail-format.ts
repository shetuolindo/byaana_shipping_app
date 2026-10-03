type DecimalValue = {
  toFixed(decimalPlaces: number): string;
};

type NullableOrderDetailFields = {
  customerName: string | null;
  address: {
    name: string | null;
    countryCode: string | null;
    address1: string | null;
  } | null;
  items: Array<{ sku: string | null }>;
};

export function getNullableOrderDetailDisplay(order: NullableOrderDetailFields) {
  return {
    customerName: order.customerName ?? "—",
    address: order.address === null
      ? null
      : {
          name: order.address.name ?? "—",
          countryCode: order.address.countryCode ?? "—",
          address1: order.address.address1 ?? "—",
        },
    itemSkus: order.items.map((item) => item.sku ?? "—"),
  };
}

export function getOrderDisplayNumber(order: {
  orderNumber: string;
}) {
  return order.orderNumber;
}

export function formatMoney(value: DecimalValue | null, currency: string | null) {
  if (value === null) return "—";

  const fixed = value.toFixed(2);
  if (!currency) return fixed;

  try {
    const [wholePart, fraction = "00"] = fixed.split(".");
    const whole = BigInt(wholePart);
    const formatter = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return formatter
      .formatToParts(whole)
      .map((part) => (part.type === "fraction" ? fraction : part.value))
      .join("");
  } catch {
    return `${fixed} ${currency}`;
  }
}

export function formatDateTime(value: Date | null) {
  if (value === null) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(value);
}

export function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
