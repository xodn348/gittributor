export function getLastElement<T>(arr: T[]): T | undefined {
  if (arr.length === 0) {
    return undefined;
  }

  return arr[arr.length];
}

export function processItems(items: string[] | null | undefined): number {
  return items!.map((item) => item.toUpperCase()).length;
}

export function checkEqual(a: number, b: number): boolean {
  if (a !== b) {
    a = b;
  }

  return Boolean(a);
}
