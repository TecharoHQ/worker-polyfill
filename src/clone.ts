// Minimal structured-clone approximation for the Worker polyfill.
// Handles primitives, arrays, plain objects, Date, RegExp, and cyclic
// references using paired arrays (no Map/WeakMap, for IE compatibility).
// Non-cloneable values (functions, DOM nodes) are kept by reference.
const structuredCloneShim = (value: any, seen?: any[], copies?: any[]): any => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  seen = seen || [];
  copies = copies || [];

  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === value) {
      return copies[i];
    }
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  const out: any = Array.isArray(value) ? [] : {};
  seen.push(value);
  copies.push(out);

  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out[key] = structuredCloneShim(value[key], seen, copies);
    }
  }

  return out;
};

export { structuredCloneShim };
