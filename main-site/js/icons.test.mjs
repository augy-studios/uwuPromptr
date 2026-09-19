// Centring check for every icon in icons.js.
//
//   node js/icons.test.mjs
//
// An icon whose geometry is not centred on the 24x24 viewBox sits visibly off
// inside a round button, which is how the play triangle shipped a whole unit
// to the right. Measuring the bounding box catches that without anybody
// having to notice it by eye.
//
// No dependencies, deliberately: this site has none, and a check that needs an
// install is a check nobody runs. It parses the handful of shapes and path
// commands the icon set actually uses, and refuses loudly on anything it does
// not understand rather than quietly reporting a wrong box.

import { icons } from "./icons.js";

// How far off centre a shape may sit, in viewBox units. Small enough to catch
// a misplaced path, loose enough to allow the optical adjustments below.
const TOLERANCE = 0.15;

// Icons that are off centre on purpose, with the reason. An asymmetric shape
// centred on its bounding box can look wrong, so the eye wins over the
// measurement; anything listed here is a decision rather than an oversight.
const INTENTIONAL = {
  play: "A triangle, whose visual mass is its centroid rather than its box centre. Nudged 0.75 units left of box-centred, so it does not read right-heavy in a round button.",
  edit: "A pencil on a diagonal, whose visual mass sits lower than its bounding box.",
  trash: "A bin whose lid reads as part of the top edge, so the body sits slightly low.",
  check: "A tick, which reads high if it is centred by its bounding box.",
};

// Every shape and command used by icons.js. Anything outside this set throws,
// so an icon added later with a curve or an arc cannot be silently mismeasured.
const SHAPE_RE = /<(path|circle|rect)\b([^>]*)>/g;
const ATTR_RE = /([a-z-]+)="([^"]*)"/g;

function attrs(source) {
  const out = {};
  for (const [, key, value] of source.matchAll(ATTR_RE)) out[key] = value;
  return out;
}

// An arc's bounding box is not given by its endpoints: the curve bulges past
// them, and for the near-circular arcs in this set that bulge *is* the box.
// Sampling the arc is shorter and harder to get wrong than solving for the
// extrema, and at this resolution it lands well inside the tolerance.
function arcPoints(x1, y1, rx, ry, rotationDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [[x2, y2]];

  // Endpoint to centre parameterisation, per the SVG spec's implementation
  // notes, then walk the sweep in small steps.
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rxAbs = Math.abs(rx);
  let ryAbs = Math.abs(ry);

  // Radii too small to span the endpoints are scaled up, again per the spec.
  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rxAbs *= scale;
    ryAbs *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator =
    rxAbs * rxAbs * ryAbs * ryAbs - rxAbs * rxAbs * y1p * y1p - ryAbs * ryAbs * x1p * x1p;
  const denominator = rxAbs * rxAbs * y1p * y1p + ryAbs * ryAbs * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = (coefficient * (rxAbs * y1p)) / ryAbs;
  const cyp = (coefficient * -((ryAbs * x1p) / rxAbs));
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const value = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs);
  let delta = angle(
    (x1p - cxp) / rxAbs,
    (y1p - cyp) / ryAbs,
    (-x1p - cxp) / rxAbs,
    (-y1p - cyp) / ryAbs
  );

  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const points = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const t = theta1 + (delta * i) / steps;
    points.push([
      cx + rxAbs * Math.cos(t) * cosPhi - ryAbs * Math.sin(t) * sinPhi,
      cy + rxAbs * Math.cos(t) * sinPhi + ryAbs * Math.sin(t) * cosPhi,
    ]);
  }
  return points;
}

// The moves, lines, and arcs the icon set uses.
function pathPoints(d, name) {
  const points = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  let i = 0;
  let command = "";

  const num = () => {
    const value = Number(tokens[i++]);
    if (Number.isNaN(value)) {
      throw new Error(`${name}: could not read a number in path "${d}"`);
    }
    return value;
  };

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];

    switch (command) {
      case "M": x = num(); y = num(); startX = x; startY = y; break;
      case "m": x += num(); y += num(); startX = x; startY = y; break;
      case "L": x = num(); y = num(); break;
      case "l": x += num(); y += num(); break;
      case "H": x = num(); break;
      case "h": x += num(); break;
      case "V": y = num(); break;
      case "v": y += num(); break;
      case "A": case "a": {
        const rx = num();
        const ry = num();
        const rotation = num();
        const largeArc = num();
        const sweep = num();
        const fromX = x;
        const fromY = y;
        if (command === "A") { x = num(); y = num(); } else { x += num(); y += num(); }
        points.push(
          ...arcPoints(fromX, fromY, rx, ry, rotation, largeArc, sweep, x, y)
        );
        break;
      }
      case "Z": case "z": x = startX; y = startY; break;
      default:
        throw new Error(
          `${name}: path command "${command}" is not handled by this check. ` +
          `Add it to pathPoints, or the bounding box will be wrong.`
        );
    }

    points.push([x, y]);
  }

  return points;
}

function iconPoints(name, svg) {
  const points = [];
  let found = 0;

  for (const [, tag, rest] of svg.matchAll(SHAPE_RE)) {
    found++;
    const a = attrs(rest);

    if (tag === "path") {
      points.push(...pathPoints(a.d, name));
    } else if (tag === "circle") {
      const cx = Number(a.cx);
      const cy = Number(a.cy);
      const r = Number(a.r);
      points.push([cx - r, cy - r], [cx + r, cy + r]);
    } else if (tag === "rect") {
      const rx = Number(a.x);
      const ry = Number(a.y);
      points.push([rx, ry], [rx + Number(a.width), ry + Number(a.height)]);
    }
  }

  if (!found) throw new Error(`${name}: no shapes found, so nothing was measured`);
  return points;
}

const failures = [];
const allowed = [];

for (const [name, svg] of Object.entries(icons)) {
  const points = iconPoints(name, svg);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);

  const dx = Number(((Math.min(...xs) + Math.max(...xs)) / 2 - 12).toFixed(2));
  const dy = Number(((Math.min(...ys) + Math.max(...ys)) / 2 - 12).toFixed(2));

  if (Math.abs(dx) <= TOLERANCE && Math.abs(dy) <= TOLERANCE) continue;
  (INTENTIONAL[name] ? allowed : failures).push({ name, dx, dy });
}

// A closed triangle is the one shape where the bounding box actively misleads:
// its visual mass sits at the centroid, a third of the way along, so a
// box-centred triangle looks pushed towards its own point. Report where the
// centroid lands so the play glyph's nudge stays a deliberate number rather
// than drifting back to "centred" on the next tidy-up.
function triangleCentroids() {
  const found = [];
  for (const [name, svg] of Object.entries(icons)) {
    for (const [, d] of svg.matchAll(/<path d="([^"]+)"/g)) {
      // Exactly three points and an explicit close: M x y, two draws, z.
      if (!/z\s*$/i.test(d)) continue;
      const points = pathPoints(d, name);
      const unique = points.filter(
        (p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]
      );
      if (unique.length !== 4) continue; // three corners plus the close
      const corners = unique.slice(0, 3);
      const cx = corners.reduce((sum, p) => sum + p[0], 0) / 3;
      const cy = corners.reduce((sum, p) => sum + p[1], 0) / 3;
      found.push({ name, cx: Number(cx.toFixed(2)), cy: Number(cy.toFixed(2)) });
    }
  }
  return found;
}

for (const { name, cx, cy } of triangleCentroids()) {
  console.log(
    `shape ${name} is a triangle: centroid at (${cx}, ${cy}), ` +
    `so its visual mass is ${(cx - 12).toFixed(2)} from the middle.`
  );
}

for (const { name, dx, dy } of allowed) {
  console.log(`note  ${name} is off centre by (${dx}, ${dy}) on purpose: ${INTENTIONAL[name]}`);
}

if (failures.length) {
  console.error("\nIcons not centred on the viewBox:");
  for (const { name, dx, dy } of failures) {
    console.error(`  ${name}: centre is off by (${dx}, ${dy}) units`);
  }
  console.error(
    "\nCentre the geometry on 12,12, or add the icon to INTENTIONAL in this file with the reason."
  );
  process.exit(1);
}

console.log(`\nAll ${Object.keys(icons).length} icons centred, within ${TOLERANCE} units.`);
