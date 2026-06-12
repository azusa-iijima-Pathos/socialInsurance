/** Firestore に保存できない undefined を再帰的に除去する */
export function stripUndefinedValues<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => stripUndefinedValues(item)) as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) {
      result[key] = stripUndefinedValues(nestedValue);
    }
  }
  return result as T;
}

function isPlainObject(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
}
