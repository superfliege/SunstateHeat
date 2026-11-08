// 2D-Geometrie für die Weltgenerierung (x = Osten, z = Süden, Einheit Meter).
// Polygone sind Punktlisten ohne wiederholten Endpunkt.

export type Vec2 = [number, number];
export type Poly = Vec2[];

export function polygonArea(p: Poly): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return a / 2;
}

export function centroid(p: Poly): Vec2 {
  let x = 0, z = 0, a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    x += (p[j][0] + p[i][0]) * f; z += (p[j][1] + p[i][1]) * f; a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = p.length || 1;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [x / (3 * a), z / (3 * a)];
}

export function pointInPolygon(x: number, z: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(p: Poly): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
}

/** Abstand Punkt–Strecke sowie Parameter t (0..1) des nächsten Punkts. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t };
}

/** Schnittpunkt zweier Strecken (a-b, c-d): Parameter t auf a-b und u auf c-d, oder null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** Schnittpunkt zweier unendlicher Geraden (Punkt + Richtung), oder null bei Parallelität. */
export function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

// ------------------------------------------------------------------ Kurven
/**
 * Catmull-Rom-Spline durch alle Kontrollpunkte, abgetastet im Abstand `spacing`.
 * Zentripetale Parametrisierung (alpha = 0.5) vermeidet Schleifen bei ungleichen Abständen.
 */
export function catmullRom(ctrl: Vec2[], spacing: number, closed = false): Vec2[] {
  if (ctrl.length < 2) return ctrl.slice();
  const n = ctrl.length;
  const get = (i: number): Vec2 => {
    if (closed) return ctrl[((i % n) + n) % n];
    if (i < 0) return [2 * ctrl[0][0] - ctrl[1][0], 2 * ctrl[0][1] - ctrl[1][1]];
    if (i >= n) return [2 * ctrl[n - 1][0] - ctrl[n - 2][0], 2 * ctrl[n - 1][1] - ctrl[n - 2][1]];
    return ctrl[i];
  };
  const out: Vec2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const td = (a: Vec2, b: Vec2) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = t0 + td(p0, p1), t2 = t1 + td(p1, p2), t3 = t2 + td(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
        const k = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      };
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  if (!closed) out.push(ctrl[n - 1]);
  return out;
}

export function polylineLength(p: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

/** Kumulierte Bogenlänge je Punkt. */
export function cumulative(p: Vec2[]): number[] {
  const c = [0];
  for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return c;
}

/** Punkt und normierte Richtung bei Bogenlänge s. */
export function pointAt(p: Vec2[], cum: number[], s: number): { x: number; z: number; dx: number; dz: number } {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let i = 1;
  // binäre Suche
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
  i = lo;
  const a = p[i - 1], b = p[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (s - cum[i - 1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
}

/** Teilstück einer Polylinie zwischen den Bogenlängen s0 und s1. */
export function subPolyline(p: Vec2[], cum: number[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = [];
  const a = pointAt(p, cum, s0);
  out.push([a.x, a.z]);
  for (let i = 0; i < p.length; i++) if (cum[i] > s0 + 0.01 && cum[i] < s1 - 0.01) out.push(p[i]);
  const b = pointAt(p, cum, s1);
  out.push([b.x, b.z]);
  return out;
}

/** Polylinie seitlich versetzen (d > 0 = rechts in Fahrtrichtung, rechts = (-dz, dx)). */
export function offsetPolyline(p: Vec2[], d: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    out.push([p[i][0] - dz * d, p[i][1] + dx * d]);
  }
  return out;
}

/** Linie gleichmäßig verdichten (für Ausfransen und Rasterung). */
export function densify(p: Vec2[], spacing: number, closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const n = p.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = p[i], b = p[(i + 1) % n];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let s = 0; s < steps; s++) out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  if (!closed) out.push(p[n - 1]);
  return out;
}

/**
 * Kante ausfransen: verdichten und jeden Punkt entlang der Normalen per Noise versetzen.
 * noise liefert 0..1; amp in Metern; wavelength = typische Buchtenbreite.
 */
export function fray(p: Poly, amp: number | ((x: number, z: number) => number), wavelength: number, noise: (x: number, z: number) => number, closed = true): Poly {
  const pts = densify(closed ? catmullRom(p, wavelength / 2, true) : p, Math.max(2, wavelength / 6), closed);
  const out: Poly = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let nx = -(b[1] - a[1]), nz = b[0] - a[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const [x, z] = pts[i];
    const f = 1 / wavelength;
    const v = (noise(x * f, z * f) - 0.5) * 2 * 0.65 + (noise(x * f * 3.1 + 17, z * f * 3.1) - 0.5) * 2 * 0.35;
    const am = typeof amp === 'number' ? amp : amp(x, z);
    out.push([x + nx * v * am, z + nz * v * am]);
  }
  return out;
}

/** Superellipse (pow 2 = Ellipse, pow 4 = abgerundetes Rechteck). */
export function superellipse(cx: number, cz: number, rx: number, rz: number, pow = 2, segs = 48, rot = 0): Poly {
  const out: Poly = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const x = Math.sign(ct) * Math.pow(Math.abs(ct), 2 / pow) * rx;
    const z = Math.sign(st) * Math.pow(Math.abs(st), 2 / pow) * rz;
    out.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return out;
}

/** Polylinie mit (variabler) Breite zu einem Polygon aufdicken. */
export function bufferPolyline(p: Vec2[], width: (i: number) => number): Poly {
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const w = width(i) / 2;
    left.push([p[i][0] + dz * w, p[i][1] - dx * w]);
    right.push([p[i][0] - dz * w, p[i][1] + dx * w]);
  }
  return [...left, ...right.reverse()];
}

/** Gedrehtes Rechteck (Mitte, Halbmaße, Winkel wie Fahrzeuge: vorwärts = (sin a, cos a)). */
export function orientedRect(cx: number, cz: number, hw: number, hd: number, rot: number): Poly {
  const s = Math.sin(rot), c = Math.cos(rot);
  // lokale x-Achse = (cos a, -sin a), lokale z-Achse = (sin a, cos a)
  const pt = (lx: number, lz: number): Vec2 => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  return [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
}

// ------------------------------------------------------------------ Rasterung
/**
 * Scanline-Füllung eines Polygons auf ein Raster (Zellgröße `cell`, `n` x `n` Zellen).
 * fill wird für jede Zelle aufgerufen, deren Mittelpunkt im Polygon liegt.
 */
export function rasterizePolygon(poly: Poly, cell: number, n: number, fill: (cx: number, cz: number) => void) {
  const [, z0, , z1] = bbox(poly);
  const rStart = Math.max(0, Math.floor(z0 / cell)), rEnd = Math.min(n - 1, Math.ceil(z1 / cell));
  const xs: number[] = [];
  for (let r = rStart; r <= rEnd; r++) {
    const z = (r + 0.5) * cell;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z)) xs.push(xi + ((z - zi) * (xj - xi)) / (zj - zi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] / cell - 0.5)), c1 = Math.min(n - 1, Math.floor(xs[k + 1] / cell - 0.5));
      for (let c = c0; c <= c1; c++) fill(c, r);
    }
  }
}

/** Alle Zellen, deren Mittelpunkt näher als `r(i)` an der Polylinie liegt. */
export function rasterizePolyline(p: Vec2[], r: (seg: number) => number, cell: number, n: number, fill: (cx: number, cz: number, seg: number, d: number) => void) {
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1];
    const rad = r(i);
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - rad) / cell)), x1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + rad) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz) - rad) / cell)), z1 = Math.min(n - 1, Math.floor((Math.max(az, bz) + rad) / cell));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const { d } = distToSegment((cx + 0.5) * cell, (cz + 0.5) * cell, ax, az, bx, bz);
        if (d <= rad) fill(cx, cz, i, d);
      }
    }
  }
}

// ------------------------------------------------------------------ Polygon-Operationen
/**
 * Polygon nach innen versetzen; dist[i] gilt für die Kante i -> i+1.
 * Funktioniert für konvexe und leicht konkave Blöcke; liefert null, wenn das Ergebnis kollabiert.
 */
export function insetPolygon(input: Poly, inputDist: number[]): Poly | null {
  if (input.length < 3) return null;
  const sign = polygonArea(input) > 0 ? 1 : -1;
  const orig = Math.abs(polygonArea(input));
  // Linien der versetzten Kanten; Kanten, die beim Versetzen umklappen, fallen weg
  let lines: { p: Vec2; d: Vec2 }[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i], b = input[(i + 1) % input.length];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    dx /= l; dz /= l;
    // Innen-Normale (polygonArea hat das umgekehrte Vorzeichen der üblichen Shoelace-Formel)
    const nx = dz * sign, nz = -dx * sign;
    lines.push({ p: [a[0] + nx * inputDist[i], a[1] + nz * inputDist[i]], d: [dx, dz] });
  }
  let out: Poly = [];
  for (let iter = 0; iter < 200; iter++) {
    const n = lines.length;
    if (n < 3) return null;
    out = [];
    for (let i = 0; i < n; i++) {
      const prev = lines[(i - 1 + n) % n], cur = lines[i];
      out.push(lineIntersection(prev.p, prev.d, cur.p, cur.d) ?? [cur.p[0], cur.p[1]]);
    }
    // Kante i läuft von out[i] nach out[i+1]; zeigt sie rückwärts, ist sie kollabiert
    let worst = -1, worstDot = 0;
    for (let i = 0; i < n; i++) {
      const a = out[i], b = out[(i + 1) % n];
      const dot = (b[0] - a[0]) * lines[i].d[0] + (b[1] - a[1]) * lines[i].d[1];
      if (dot < worstDot) { worstDot = dot; worst = i; }
    }
    if (worst < 0) break;
    lines = lines.filter((_, i) => i !== worst);
  }
  const n = out.length;
  const a = polygonArea(out);
  if (Math.sign(a) !== sign || Math.abs(a) < orig * 0.08 || Math.abs(a) >= orig) return null;
  // Selbstüberschneidung grob prüfen
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentIntersection(out[i], out[(i + 1) % n], out[j], out[(j + 1) % n])) return null;
    }
  }
  return out;
}

/** Fast gerade Punkte entfernen (vereinfacht abgetastete Kurven für die Unterteilung). */
export function simplify(poly: Poly, tol: number): Poly {
  if (poly.length <= 4) return poly;
  const out: Poly = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = out.length ? out[out.length - 1] : poly[n - 1], b = poly[i], c = poly[(i + 1) % n];
    if (distToSegment(b[0], b[1], a[0], a[1], c[0], c[1]).d > tol) out.push(b);
  }
  return out.length >= 3 ? out : poly;
}

/** Polygon an einer Geraden (Punkt + Richtung) teilen; für konvexe Polygone exakt. */
export function splitPolygon(poly: Poly, p: Vec2, d: Vec2): [Poly, Poly] {
  const side = (q: Vec2) => (q[0] - p[0]) * d[1] - (q[1] - p[1]) * d[0];
  const a: Poly = [], b: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], nxt = poly[(i + 1) % poly.length];
    const sc = side(cur), sn = side(nxt);
    (sc >= 0 ? a : b).push(cur);
    if ((sc >= 0) !== (sn >= 0)) {
      const t = sc / (sc - sn);
      const q: Vec2 = [cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t];
      a.push(q); b.push(q);
    }
  }
  return [a, b];
}
