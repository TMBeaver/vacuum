export function companionPose(w, h, d) {
  const turn = Math.max(3, h * 0.11),
    left = 42,
    right = w - 18 - turn,
    cy = h * 0.5,
    line = Math.max(24, right - left),
    arc = Math.PI * turn,
    total = 2 * line + 2 * arc;
  if (d < 0) {
    const t = Math.max(0, Math.min(1, (d + 36) / 36));
    return { x: 18 + (left - 18) * t, y: cy - turn * t, a: 0 };
  }
  d %= total;
  if (d < line) return { x: left + d, y: cy - turn, a: 0 };
  d -= line;
  if (d < arc) {
    const a = -Math.PI / 2 + d / turn;
    return {
      x: right + turn * Math.cos(a),
      y: cy + turn * Math.sin(a),
      a: a + Math.PI / 2,
    };
  }
  d -= arc;
  if (d < line) return { x: right - d, y: cy + turn, a: Math.PI };
  d -= line;
  const a = Math.PI / 2 + d / turn;
  return {
    x: left + turn * Math.cos(a),
    y: cy + turn * Math.sin(a),
    a: a + Math.PI / 2,
  };
}
