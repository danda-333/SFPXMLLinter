import { IndexedComponent, WorkspaceIndex } from "./types";

export function resolveComponentByKey(index: WorkspaceIndex, componentKey: string): IndexedComponent | undefined {
  const normalized = componentKey;
  const direct = index.componentsByKey.get(normalized);
  if (direct) {
    return direct;
  }

  const base = normalized.split("/").pop();
  if (!base) {
    return undefined;
  }

  const variants = index.componentKeysByBaseName.get(base);
  if (!variants || variants.size === 0) {
    return undefined;
  }

  if (variants.size === 1) {
    const only = [...variants][0];
    return index.componentsByKey.get(only);
  }

  for (const candidate of variants) {
    if (candidate.endsWith(`/${normalized}`) || candidate === normalized) {
      return index.componentsByKey.get(candidate);
    }
  }

  return undefined;
}
