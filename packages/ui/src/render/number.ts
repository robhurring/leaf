/** `1` → `1.`, `1.2` → `1.2`: top-level numbers get a trailing period, nested ones do not. */
export const formatNumber = (n: string) => (n.includes('.') ? n : `${n}.`);
