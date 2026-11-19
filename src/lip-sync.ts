/** Never write a nonexistent Cubism parameter: the SDK silently accepts those. */
export function resolveMouthParameters(
  requested: string,
  available: readonly string[],
  declared: readonly string[],
): string[] {
  if (available.includes(requested)) return [requested];
  const declaredIds = declared.filter((id) => available.includes(id));
  if (declaredIds.length) return [...new Set(declaredIds)];
  return ["ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y", "ParamA"]
    .filter((id) => available.includes(id)).slice(0, 1);
}

export function mouthParameterValue(level: number, min: number, max: number) {
  const closed = Math.min(max, Math.max(min, 0));
  return closed + (max - closed) * Math.min(1, Math.max(0, level));
}
