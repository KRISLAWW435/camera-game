import type { NormalizedBox, TrackingResult, TrackingSettings } from '../types/tracking';

export const ANALYSIS_WIDTH = 320;

export function computeAnalysisDimensions(
  videoWidth: number,
  videoHeight: number
): { width: number; height: number } {
  const aspect = videoHeight / videoWidth;
  return {
    width: ANALYSIS_WIDTH,
    height: Math.max(60, Math.round(ANALYSIS_WIDTH * aspect)),
  };
}

export interface HsvThresholds {
  hueMin: number;
  hueMax: number;
  minSaturation: number;
  minValue: number;
}

/**
 * Maps sensitivity (1..100) to HSV thresholds centered on green (~120°).
 * Higher sensitivity widens the hue window and lowers saturation/value floors
 * so recognition works in dimmer rooms or with paler green objects.
 */
export function deriveHsvThresholds(sensitivity: number): HsvThresholds {
  const clamped = Math.max(1, Math.min(100, sensitivity));
  const t = (clamped - 1) / 99; // 0..1

  const hueTolerance = 26 + t * 28; // ±26° (strict) .. ±54° (wide)
  const hueMin = 120 - hueTolerance;
  const hueMax = 120 + hueTolerance;
  const minSaturation = 0.44 - t * 0.30; // 0.44 .. 0.14
  const minValue = 0.28 - t * 0.20; // 0.28 .. 0.08

  return { hueMin, hueMax, minSaturation, minValue };
}

/**
 * Converts RGB (0..255) to HSV where H is [0, 360), S is [0, 1], V is [0, 1].
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = rn > gn ? (rn > bn ? rn : bn) : gn > bn ? gn : bn;
  const min = rn < gn ? (rn < bn ? rn : bn) : gn < bn ? gn : bn;
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return [h, s, v];
}

export class GreenTrackerWorkspace {
  private mask: Uint8Array = new Uint8Array(0);
  private visited: Uint8Array = new Uint8Array(0);
  private queue: Int32Array = new Int32Array(0);

  private ensureCapacity(totalPixels: number) {
    if (this.mask.length !== totalPixels) {
      this.mask = new Uint8Array(totalPixels);
      this.visited = new Uint8Array(totalPixels);
      this.queue = new Int32Array(totalPixels);
    } else {
      this.visited.fill(0);
    }
  }

  /**
   * Analyzes an ImageData frame using HSV green filtering and largest-component
   * clustering to discard small noisy speckles. Optionally writes a visual mask
   * into `maskOutput` (same dimensions as `frame`).
   */
  analyzeFrame(
    frame: ImageData,
    settings: TrackingSettings,
    maskOutput?: ImageData | null
  ): TrackingResult {
    const { width, height, data } = frame;
    const totalPixels = width * height;
    this.ensureCapacity(totalPixels);

    const thresholds = deriveHsvThresholds(settings.sensitivity);
    const minAreaPixels = Math.max(
      12,
      Math.round((settings.minAreaPercent / 100) * totalPixels)
    );

    const mask = this.mask;
    const maskOutData = maskOutput ? maskOutput.data : null;

    // Step 1: Pixel-level HSV green classification
    for (let i = 0; i < totalPixels; i++) {
      const offset = i * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];

      // Quick reject when green isn't meaningfully present before full HSV math
      if (g <= r && g <= b) {
        mask[i] = 0;
        if (maskOutData) {
          maskOutData[offset] = 0;
          maskOutData[offset + 1] = 0;
          maskOutData[offset + 2] = 0;
          maskOutData[offset + 3] = 0;
        }
        continue;
      }

      const [h, s, v] = rgbToHsv(r, g, b);
      const isGreen =
        h >= thresholds.hueMin &&
        h <= thresholds.hueMax &&
        s >= thresholds.minSaturation &&
        v >= thresholds.minValue;

      mask[i] = isGreen ? 1 : 0;

      if (maskOutData) {
        if (isGreen) {
          maskOutData[offset] = 34;
          maskOutData[offset + 1] = 197;
          maskOutData[offset + 2] = 94;
          maskOutData[offset + 3] = 155;
        } else {
          maskOutData[offset] = 0;
          maskOutData[offset + 1] = 0;
          maskOutData[offset + 2] = 0;
          maskOutData[offset + 3] = 0;
        }
      }
    }

    // Step 2: Find largest 4-connected green region to ignore background specks
    const visited = this.visited;
    const queue = this.queue;

    let bestCount = 0;
    let bestSumX = 0;
    let bestSumY = 0;
    let bestMinX = width;
    let bestMinY = height;
    let bestMaxX = 0;
    let bestMaxY = 0;

    for (let idx = 0; idx < totalPixels; idx++) {
      if (mask[idx] === 0 || visited[idx] === 1) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      visited[idx] = 1;

      let count = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;

      while (head < tail) {
        const curr = queue[head++];
        const x = curr % width;
        const y = (curr / width) | 0;

        count++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // Left
        if (x > 0) {
          const left = curr - 1;
          if (mask[left] === 1 && visited[left] === 0) {
            visited[left] = 1;
            queue[tail++] = left;
          }
        }
        // Right
        if (x < width - 1) {
          const right = curr + 1;
          if (mask[right] === 1 && visited[right] === 0) {
            visited[right] = 1;
            queue[tail++] = right;
          }
        }
        // Up
        if (y > 0) {
          const up = curr - width;
          if (mask[up] === 1 && visited[up] === 0) {
            visited[up] = 1;
            queue[tail++] = up;
          }
        }
        // Down
        if (y < height - 1) {
          const down = curr + width;
          if (mask[down] === 1 && visited[down] === 0) {
            visited[down] = 1;
            queue[tail++] = down;
          }
        }
      }

      if (count > bestCount) {
        bestCount = count;
        bestSumX = sumX;
        bestSumY = sumY;
        bestMinX = minX;
        bestMinY = minY;
        bestMaxX = maxX;
        bestMaxY = maxY;
      }
    }

    if (bestCount < minAreaPixels) {
      return {
        detected: false,
        x: 0.5,
        y: 0.5,
        areaPercent: (bestCount / totalPixels) * 100,
        box: null,
      };
    }

    // Mirror X so moving object to the user's right moves virtual circle right
    const rawCenterX = bestSumX / bestCount;
    const rawCenterY = bestSumY / bestCount;
    const mirroredX = Math.max(0, Math.min(1, 1 - rawCenterX / width));
    const normalizedY = Math.max(0, Math.min(1, rawCenterY / height));

    const box: NormalizedBox = {
      minX: Math.max(0, Math.min(1, 1 - (bestMaxX + 1) / width)),
      maxX: Math.max(0, Math.min(1, 1 - bestMinX / width)),
      minY: Math.max(0, Math.min(1, bestMinY / height)),
      maxY: Math.max(0, Math.min(1, (bestMaxY + 1) / height)),
    };

    return {
      detected: true,
      x: mirroredX,
      y: normalizedY,
      areaPercent: (bestCount / totalPixels) * 100,
      box,
    };
  }
}

/**
 * Exponential moving average with micro-jitter deadzone for smooth circle movement.
 */
export function smoothPosition(
  prev: { x: number; y: number } | null,
  target: { x: number; y: number },
  smoothing: number
): { x: number; y: number } {
  if (!prev) return { x: target.x, y: target.y };

  const dx = target.x - prev.x;
  const dy = target.y - prev.y;
  const dist = Math.hypot(dx, dy);

  // Deadzone suppresses camera sensor shimmer when object is held still
  if (dist < 0.0025) {
    return prev;
  }

  // Higher smoothing -> smaller alpha; adaptive boost on fast movements reduces lag
  const baseAlpha = 1 - Math.max(0, Math.min(0.92, smoothing));
  const adaptiveAlpha = Math.min(1, baseAlpha + dist * 0.45);

  return {
    x: prev.x + dx * adaptiveAlpha,
    y: prev.y + dy * adaptiveAlpha,
  };
}
