export type Vec3 = { x: number; y: number; z: number };

export type PathNode = {
  id: string;
  position: Vec3;
  links: string[]; // bidirectional: both sides stored
};

export function v3dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function nearestNodeId(pos: Vec3, nodes: Record<string, PathNode>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, n] of Object.entries(nodes)) {
    const d = v3dist(pos, n.position);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

export function dijkstra(
  nodes: Record<string, PathNode>,
  startId: string,
  endId: string,
): string[] | null {
  if (startId === endId) return [startId];
  const ids = Object.keys(nodes);
  if (!ids.includes(startId) || !ids.includes(endId)) return null;

  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const unvisited = new Set<string>(ids);
  for (const id of ids) {
    dist[id] = Infinity;
    prev[id] = null;
  }
  dist[startId] = 0;

  while (unvisited.size > 0) {
    // Pick unvisited node with minimum distance
    let u = "";
    let minD = Infinity;
    for (const id of unvisited) {
      if (dist[id] < minD) {
        minD = dist[id];
        u = id;
      }
    }
    if (!u || minD === Infinity) break;
    if (u === endId) break;
    unvisited.delete(u);

    const node = nodes[u];
    if (!node) continue;
    for (const nbId of node.links) {
      if (!unvisited.has(nbId)) continue;
      const nb = nodes[nbId];
      if (!nb) continue;
      const alt = dist[u] + v3dist(node.position, nb.position);
      if (alt < dist[nbId]) {
        dist[nbId] = alt;
        prev[nbId] = u;
      }
    }
  }

  // Reconstruct path
  const path: string[] = [];
  let cur: string | null = endId;
  while (cur !== null) {
    path.unshift(cur);
    const p: string | null = prev[cur] ?? null;
    if (p === null) break;
    cur = p;
  }
  return path[0] === startId ? path : null;
}

/**
 * Build a world-space path from fromPos → (nearest node) → ... → (nearest node) → toPos.
 * Returns array of Vec3 positions.
 */
export function buildNavPath(
  fromPos: Vec3,
  toPos: Vec3,
  nodes: Record<string, PathNode>,
  fromNodeOverride?: string | null,
  toNodeOverride?: string | null,
): Vec3[] {
  const ids = Object.keys(nodes);
  if (ids.length === 0) return [fromPos, toPos];

  const startId = fromNodeOverride ?? nearestNodeId(fromPos, nodes);
  const endId = toNodeOverride ?? nearestNodeId(toPos, nodes);
  if (!startId || !endId) return [fromPos, toPos];

  const nodePath = dijkstra(nodes, startId, endId);
  if (!nodePath || nodePath.length === 0) return [fromPos, toPos];

  const positions: Vec3[] = [fromPos];

  // Skip first node if very close to fromPos
  const firstNode = nodes[startId];
  const skipFirst = firstNode && v3dist(fromPos, firstNode.position) < 0.15;
  const nodeSlice = skipFirst ? nodePath.slice(1) : nodePath;
  for (const id of nodeSlice) {
    const n = nodes[id];
    if (n) positions.push(n.position);
  }

  // Skip last node if very close to toPos
  const lastNode = nodes[endId];
  if (!lastNode || v3dist(toPos, lastNode.position) >= 0.15) {
    positions.push(toPos);
  }

  return positions;
}

/**
 * Compute cumulative arc lengths for a path. Returns array length = path.length.
 * arcLengths[0] = 0, arcLengths[last] = totalLength
 */
export function computeArcLengths(path: Vec3[]): number[] {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + v3dist(path[i - 1], path[i]));
  }
  return lengths;
}

/**
 * Given a traversed distance along arc-length parameterized path, return
 * the interpolated position.
 */
export function samplePath(
  path: Vec3[],
  arcLengths: number[],
  distTraveled: number,
): { pos: Vec3; segIdx: number; segT: number } {
  const total = arcLengths[arcLengths.length - 1];
  if (distTraveled <= 0) return { pos: path[0], segIdx: 0, segT: 0 };
  if (distTraveled >= total) return { pos: path[path.length - 1], segIdx: path.length - 2, segT: 1 };

  let seg = 0;
  for (let i = 1; i < arcLengths.length; i++) {
    if (arcLengths[i] >= distTraveled) {
      seg = i - 1;
      break;
    }
  }
  const segLen = arcLengths[seg + 1] - arcLengths[seg];
  const segT = segLen > 0 ? (distTraveled - arcLengths[seg]) / segLen : 0;

  const a = path[seg];
  const b = path[seg + 1];
  return {
    pos: {
      x: a.x + (b.x - a.x) * segT,
      y: a.y + (b.y - a.y) * segT,
      z: a.z + (b.z - a.z) * segT,
    },
    segIdx: seg,
    segT,
  };
}
