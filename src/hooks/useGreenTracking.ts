import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TRACKING_SETTINGS,
  type CameraEnvironmentInfo,
  type CameraErrorDetails,
  type CameraStatus,
  type StreamDiagnostics,
  type TrackingResult,
  type TrackingSettings,
} from '../types/tracking';
import {
  computeAnalysisDimensions,
  GreenTrackerWorkspace,
  smoothPosition,
} from '../utils/colorTracking';

const MISSED_FRAMES_THRESHOLD = 4;

const INITIAL_TRACKING: TrackingResult = {
  detected: false,
  x: 0.5,
  y: 0.5,
  areaPercent: 0,
  box: null,
};

const INITIAL_STREAM_DIAGNOSTICS: StreamDiagnostics = {
  hasStream: false,
  activeVideoTracks: 0,
  videoPlaying: false,
  firstFrameReceived: false,
  resolution: null,
  trackLabel: null,
};

interface PolicyDocument extends Document {
  permissionsPolicy?: {
    allowsFeature?: (feature: string) => boolean;
  };
  featurePolicy?: {
    allowsFeature?: (feature: string) => boolean;
  };
}

function readSyncEnvironmentInfo(): CameraEnvironmentInfo {
  const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
  const hasMediaDevices =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
  const hasGetUserMedia =
    hasMediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

  let inIframe = false;
  try {
    inIframe = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    inIframe = true;
  }

  let permissionsPolicyAllowed: boolean | null = null;
  if (typeof document !== 'undefined') {
    const doc = document as PolicyDocument;
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (policy && typeof policy.allowsFeature === 'function') {
      try {
        permissionsPolicyAllowed = policy.allowsFeature('camera');
      } catch {
        permissionsPolicyAllowed = null;
      }
    }
  }

  return {
    isSecureContext,
    hasMediaDevices,
    hasGetUserMedia,
    inIframe,
    permissionsPolicyAllowed,
    permissionState: 'unknown',
  };
}

async function queryCameraPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return 'unknown';
    }
    const result = await navigator.permissions.query({
      name: 'camera' as PermissionName,
    });
    return result.state;
  } catch {
    return 'unknown';
  }
}

function buildErrorDetails(
  err: unknown,
  env: CameraEnvironmentInfo
): { nextStatus: 'denied' | 'error'; details: CameraErrorDetails } {
  const errorObj = err instanceof Error ? err : null;
  const rawName =
    (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string'
      ? (err as { name: string }).name
      : errorObj?.name) || 'UnknownError';
  const rawMessage =
    (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string'
      ? (err as { message: string }).message
      : errorObj?.message) || String(err || 'Неизвестная ошибка');

  const lowerMsg = rawMessage.toLowerCase();

  if (rawName === 'NotAllowedError' || rawName === 'PermissionDeniedError') {
    const blockedByIframePolicy =
      env.permissionsPolicyAllowed === false ||
      lowerMsg.includes('permissions policy') ||
      lowerMsg.includes('feature policy') ||
      (env.inIframe && lowerMsg.includes('permission'));

    if (blockedByIframePolicy) {
      return {
        nextStatus: 'denied',
        details: {
          name: rawName,
          message: rawMessage,
          explanation: env.inIframe
            ? 'Запрос заблокирован политикой iframe предпросмотра (Permissions Policy) или запретом камеры. Перезагрузите предпросмотр после обновления metadata.json или откройте приложение в отдельной вкладке.'
            : 'Доступ к камере отклонён. Разрешите камеру в настройках сайта в браузере и повторите попытку.',
        },
      };
    }

    return {
      nextStatus: 'denied',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: env.inIframe
          ? 'Браузер или встроенный предпросмотр (iframe) запретил доступ к камере. Проверьте разрешение камеры в адресной строке или откройте приложение в отдельной вкладке.'
          : 'Пользователь или браузер запретил доступ к камере. Нажмите на значок камеры/замка в адресной строке, разрешите доступ и повторите попытку.',
      },
    };
  }

  if (rawName === 'NotFoundError' || rawName === 'DevicesNotFoundError') {
    return {
      nextStatus: 'error',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: 'Веб-камера не найдена. Подключите камеру к компьютеру и проверьте её работу в системе.',
      },
    };
  }

  if (rawName === 'NotReadableError' || rawName === 'TrackStartError') {
    return {
      nextStatus: 'error',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: 'Камера обнаружена, но занята другим приложением или вкладкой, либо заблокирована на уровне ОС.',
      },
    };
  }

  if (rawName === 'OverconstrainedError' || rawName === 'ConstraintNotSatisfiedError') {
    return {
      nextStatus: 'error',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: 'Камера не поддерживает запрошенные параметры видеопотока.',
      },
    };
  }

  if (rawName === 'SecurityError') {
    return {
      nextStatus: 'error',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: 'Доступ к камере заблокирован политикой безопасности (проверьте HTTPS и настройки iframe).',
      },
    };
  }

  if (rawName === 'TypeError') {
    return {
      nextStatus: 'error',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: 'Некорректный вызов getUserMedia или API камеры недоступен в текущем контексте браузера.',
      },
    };
  }

  if (rawName === 'AbortError') {
    return {
      nextStatus: 'error',
      details: {
        name: rawName,
        message: rawMessage,
        explanation: 'Запуск видеопотока был прерван браузером до завершения инициализации.',
      },
    };
  }

  return {
    nextStatus: 'error',
    details: {
      name: rawName,
      message: rawMessage,
      explanation: 'Произошла непредвиденная ошибка при запуске веб-камеры.',
    },
  };
}

export function useGreenTracking() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const firstFrameRef = useRef(false);

  const workspaceRef = useRef<GreenTrackerWorkspace | null>(null);
  const smoothedPosRef = useRef<{ x: number; y: number } | null>(null);
  const missedFramesRef = useRef(0);

  const [settings, setSettings] = useState<TrackingSettings>(DEFAULT_TRACKING_SETTINGS);
  const settingsRef = useRef<TrackingSettings>(settings);
  settingsRef.current = settings;

  const [status, setStatus] = useState<CameraStatus>('off');
  const [errorDetails, setErrorDetails] = useState<CameraErrorDetails | null>(null);
  const [envInfo, setEnvInfo] = useState<CameraEnvironmentInfo>(() => readSyncEnvironmentInfo());
  const [streamDiagnostics, setStreamDiagnostics] = useState<StreamDiagnostics>(
    INITIAL_STREAM_DIAGNOSTICS
  );
  const [tracking, setTracking] = useState<TrackingResult>(INITIAL_TRACKING);
  const [smoothedPosition, setSmoothedPosition] = useState<{ x: number; y: number } | null>(
    null
  );

  const refreshEnvironmentInfo = useCallback(async (): Promise<CameraEnvironmentInfo> => {
    const syncInfo = readSyncEnvironmentInfo();
    const permissionState = await queryCameraPermissionState();
    const fullInfo: CameraEnvironmentInfo = {
      ...syncInfo,
      permissionState,
    };
    setEnvInfo(fullInfo);
    return fullInfo;
  }, []);

  useEffect(() => {
    void refreshEnvironmentInfo();
  }, [refreshEnvironmentInfo]);

  const stopLoopAndStream = useCallback(() => {
    cancelledRef.current = true;
    firstFrameRef.current = false;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.onended = null;
        track.stop();
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    if (maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
    }

    smoothedPosRef.current = null;
    missedFramesRef.current = 0;
    setStreamDiagnostics(INITIAL_STREAM_DIAGNOSTICS);
  }, []);

  const stopCamera = useCallback(() => {
    stopLoopAndStream();
    setStatus('off');
    setErrorDetails(null);
    setTracking(INITIAL_TRACKING);
    setSmoothedPosition(null);
  }, [stopLoopAndStream]);

  const startAnalysisLoop = useCallback(() => {
    if (!workspaceRef.current) {
      workspaceRef.current = new GreenTrackerWorkspace();
    }
    if (!analysisCanvasRef.current) {
      analysisCanvasRef.current = document.createElement('canvas');
    }

    let maskImageData: ImageData | null = null;

    const processFrame = () => {
      if (cancelledRef.current) return;

      const video = videoRef.current;
      const analysisCanvas = analysisCanvasRef.current;

      if (
        video &&
        analysisCanvas &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        if (!firstFrameRef.current) {
          firstFrameRef.current = true;
          const liveTracks = streamRef.current
            ? streamRef.current.getVideoTracks().filter((t) => t.readyState === 'live')
            : [];
          setStreamDiagnostics((prev) => ({
            ...prev,
            hasStream: Boolean(streamRef.current),
            activeVideoTracks: liveTracks.length,
            videoPlaying: !video.paused,
            firstFrameReceived: true,
            resolution: `${video.videoWidth}×${video.videoHeight}`,
            trackLabel: liveTracks[0]?.label || prev.trackLabel,
          }));
        }

        const { width, height } = computeAnalysisDimensions(
          video.videoWidth,
          video.videoHeight
        );

        if (analysisCanvas.width !== width || analysisCanvas.height !== height) {
          analysisCanvas.width = width;
          analysisCanvas.height = height;
          maskImageData = null;
        }

        const analysisCtx = analysisCanvas.getContext('2d', {
          willReadFrequently: true,
        });

        if (analysisCtx) {
          analysisCtx.drawImage(video, 0, 0, width, height);
          const frame = analysisCtx.getImageData(0, 0, width, height);

          const currentSettings = settingsRef.current;
          const maskCanvas = maskCanvasRef.current;
          let maskCtx: CanvasRenderingContext2D | null = null;

          if (maskCanvas && currentSettings.showMaskOverlay) {
            if (maskCanvas.width !== width || maskCanvas.height !== height) {
              maskCanvas.width = width;
              maskCanvas.height = height;
              maskImageData = null;
            }
            maskCtx = maskCanvas.getContext('2d');
            if (maskCtx && !maskImageData) {
              maskImageData = maskCtx.createImageData(width, height);
            }
          } else if (maskCanvas) {
            const ctx = maskCanvas.getContext('2d');
            ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
          }

          const result = workspaceRef.current!.analyzeFrame(
            frame,
            currentSettings,
            currentSettings.showMaskOverlay ? maskImageData : null
          );

          if (maskCtx && maskImageData && currentSettings.showMaskOverlay) {
            maskCtx.putImageData(maskImageData, 0, 0);
          }

          if (result.detected) {
            missedFramesRef.current = 0;
            const nextSmooth = smoothPosition(
              smoothedPosRef.current,
              { x: result.x, y: result.y },
              currentSettings.smoothing
            );
            smoothedPosRef.current = nextSmooth;

            setStatus('detected');
            setTracking(result);
            setSmoothedPosition(nextSmooth);
          } else {
            missedFramesRef.current += 1;
            if (missedFramesRef.current >= MISSED_FRAMES_THRESHOLD) {
              smoothedPosRef.current = null;
              setStatus('no_object');
              setTracking(result);
              setSmoothedPosition(null);
            }
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(processFrame);
    };

    rafIdRef.current = requestAnimationFrame(processFrame);
  }, []);

  const startCamera = useCallback(async () => {
    stopLoopAndStream();
    cancelledRef.current = false;
    setStatus('starting');
    setErrorDetails(null);

    const currentEnv = readSyncEnvironmentInfo();
    setEnvInfo(currentEnv);

    if (!currentEnv.isSecureContext) {
      setStatus('error');
      setErrorDetails({
        name: 'SecurityError',
        message: 'window.isSecureContext === false',
        explanation:
          'Камера недоступна в небезопасном контексте. Откройте приложение по HTTPS или на localhost.',
      });
      return;
    }

    if (!currentEnv.hasMediaDevices || !currentEnv.hasGetUserMedia) {
      setStatus('error');
      setErrorDetails({
        name: 'TypeError',
        message: 'navigator.mediaDevices.getUserMedia is undefined',
        explanation:
          'API getUserMedia недоступно в этом браузере или окружении. Попробуйте открыть приложение в современном браузере по HTTPS.',
      });
      return;
    }

    let obtainedStream: MediaStream | null = null;

    try {
      try {
        obtainedStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (constraintErr) {
        const errName = constraintErr instanceof Error ? constraintErr.name : '';
        if (
          errName === 'OverconstrainedError' ||
          errName === 'ConstraintNotSatisfiedError'
        ) {
          obtainedStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw constraintErr;
        }
      }

      if (cancelledRef.current) {
        for (const track of obtainedStream.getTracks()) {
          track.stop();
        }
        return;
      }

      const videoTracks = obtainedStream.getVideoTracks();
      const liveTracks = videoTracks.filter((t) => t.readyState === 'live');
      if (videoTracks.length === 0) {
        for (const track of obtainedStream.getTracks()) {
          track.stop();
        }
        throw new DOMException(
          'Полученный MediaStream не содержит активных видеодорожек.',
          'NotFoundError'
        );
      }

      streamRef.current = obtainedStream;

      const activeTrack = videoTracks[0];
      activeTrack.onended = () => {
        if (cancelledRef.current) return;
        stopLoopAndStream();
        setStatus('error');
        setTracking(INITIAL_TRACKING);
        setSmoothedPosition(null);
        setErrorDetails({
          name: 'AbortError',
          message: 'Video track ended unexpectedly',
          explanation:
            'Видеопоток с камеры был прерван (камера отключена или доступ отозван). Нажмите «Повторить».',
        });
      };

      const video = videoRef.current;
      if (!video) {
        throw new Error('Элемент <video> не найден в DOM.');
      }

      // Attach stream and call play() immediately without waiting on metadata first
      // so user-gesture autoplay activation is preserved in strict iframe contexts
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = obtainedStream;

      await video.play();
      if (cancelledRef.current) return;

      const trackSettings = activeTrack.getSettings();
      const w = video.videoWidth || trackSettings.width || 0;
      const h = video.videoHeight || trackSettings.height || 0;

      setStreamDiagnostics({
        hasStream: true,
        activeVideoTracks: liveTracks.length,
        videoPlaying: !video.paused,
        firstFrameReceived: video.readyState >= 2 && video.videoWidth > 0,
        resolution: w > 0 && h > 0 ? `${w}×${h}` : null,
        trackLabel: activeTrack.label || 'Веб-камера',
      });

      void refreshEnvironmentInfo();
      setStatus('no_object');
      startAnalysisLoop();
    } catch (err) {
      if (obtainedStream) {
        for (const track of obtainedStream.getTracks()) {
          track.onended = null;
          track.stop();
        }
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setStreamDiagnostics(INITIAL_STREAM_DIAGNOSTICS);

      if (cancelledRef.current) return;

      const updatedEnv = await refreshEnvironmentInfo();
      const { nextStatus, details } = buildErrorDetails(err, updatedEnv);
      setStatus(nextStatus);
      setErrorDetails(details);
    }
  }, [refreshEnvironmentInfo, startAnalysisLoop, stopLoopAndStream]);

  const updateSettings = useCallback((partial: Partial<TrackingSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_TRACKING_SETTINGS);
  }, []);

  useEffect(() => {
    return () => {
      stopLoopAndStream();
    };
  }, [stopLoopAndStream]);

  return {
    videoRef,
    maskCanvasRef,
    status,
    errorDetails,
    envInfo,
    streamDiagnostics,
    tracking,
    smoothedPosition,
    settings,
    startCamera,
    stopCamera,
    updateSettings,
    resetSettings,
  };
}
