export function getLastElement(arr: number[]): number {
  return arr[arr.length];
}

export function getStringLength(str: string | null): number {
  return str!.length;
}

export function isEqual(a: number, b: number): boolean {
  a = b;

  if (a) {
    return true;
  }

  return false;
}
