import type { OrderSource } from "@prisma/client";

export type ChronologicalOrder = {
  id: string;
  source: OrderSource;
  externalCreatedAt: Date | null;
  createdAt: Date;
};

export type ChronologicalDirection = "asc" | "desc";

function compareText(first: string, second: string) {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

function compareChronologically(
  first: ChronologicalOrder,
  second: ChronologicalOrder,
  direction: ChronologicalDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;
  const firstTimestamp = (first.source === "SHOPIFY" ? first.externalCreatedAt : null) ?? first.createdAt;
  const secondTimestamp = (second.source === "SHOPIFY" ? second.externalCreatedAt : null) ?? second.createdAt;
  const timestampDifference = firstTimestamp.getTime() - secondTimestamp.getTime();

  if (timestampDifference !== 0) return timestampDifference * multiplier;

  const createdAtDifference = first.createdAt.getTime() - second.createdAt.getTime();
  if (createdAtDifference !== 0) return createdAtDifference * multiplier;

  return compareText(first.id, second.id) * multiplier;
}

export function selectChronologicalOrderPage<T extends ChronologicalOrder>(
  groups: readonly (readonly T[])[],
  direction: ChronologicalDirection,
  skip: number,
  take: number,
) {
  return groups
    .flat()
    .sort((first, second) => compareChronologically(first, second, direction))
    .slice(skip, skip + take);
}
