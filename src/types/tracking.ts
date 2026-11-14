export type CameraStatus =
  | 'off'
  | 'starting'
  | 'denied'
  | 'error'
  | 'no_object'
  | 'detected';

export interface CameraErrorDetails {
  name: string;
  message: string;
  explanation: string;
}

export interface CameraEnvironmentInfo {
  isSecureContext: boolean;
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  inIframe: boolean;
  permissionsPolicyAllowed: boolean | null;
  permissionState: PermissionState | 'unknown';
}

export interface StreamDiagnostics {
  hasStream: boolean;
  activeVideoTracks: number;
  videoPlaying: boolean;
  firstFrameReceived: boolean;
  resolution: string | null;
  trackLabel: string | null;
}

export interface TrackingSettings {
  /** Overall HSV green sensitivity from 1 (strict) to 100 (wide/dim light) */
  sensitivity: number;
  /** Coordinate smoothing factor from 0 (raw) to 0.92 (very smooth) */
  smoothing: number;
  /** Minimum contiguous green region area as percentage of frame (0.2 to 4.0) */
  minAreaPercent: number;
  /** Whether to draw the detected HSV green pixel mask on the camera preview */
  showMaskOverlay: boolean;
}

export interface NormalizedBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TrackingResult {
  detected: boolean;
  /** Mirrored X in [0, 1]: moving real object right increases X */
  x: number;
  /** Normalized Y in [0, 1]: top is 0, bottom is 1 */
  y: number;
  /** Area of the largest detected green region as % of total frame */
  areaPercent: number;
  /** Mirrored bounding box in [0, 1] */
  box: NormalizedBox | null;
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  sensitivity: 55,
  smoothing: 0.65,
  minAreaPercent: 0.5,
  showMaskOverlay: true,
};
