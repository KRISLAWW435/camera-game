import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Cpu, Play, Square } from 'lucide-react';

type TestStage =
  | 'idle'
  | 'requesting_stream'
  | 'stream_ready'
  | 'getUserMedia_error';

type PlayPromiseState = 'idle' | 'pending' | 'resolved' | 'rejected';

type ProbeMethodState =
  | 'idle'
  | 'unsupported'
  | 'running'
  | 'success'
  | 'timeout'
  | 'error'
  | 'skipped';

interface GetUserMediaErrorInfo {
  stage: string;
  name: string;
  message: string;
  constraint?: string;
}

interface PlayErrorInfo {
  name: string;
  message: string;
}

interface ProbeErrorInfo {
  name: string;
  message: string;
}

interface CapturedFrameMeta {
  index: number;
  source: 'MediaStreamTrackProcessor' | 'ImageCapture';
  width: number;
  height: number;
  timestamp: number | null;
  deltaMs: number | null;
}

interface EventLogEntry {
  id: number;
  elapsedMs: number;
  source: 'video' | 'track' | 'action' | 'direct';
  event: string;
  detail: string;
}

interface LiveDiagnostics {
  videoIsConnected: boolean;
  srcObjectMatchesStream: boolean;
  videoPaused: boolean | null;
  videoReadyState: number;
  videoNetworkState: number;
  videoWidth: number;
  videoHeight: number;
  trackCount: number;
  deviceLabel: string;
  trackEnabled: boolean | null;
  trackMuted: boolean | null;
  trackReadyState: string;
  trackSettings: MediaTrackSettings | null;
}

interface VideoFrameLike {
  displayWidth?: number;
  displayHeight?: number;
  codedWidth?: number;
  codedHeight?: number;
  timestamp?: number;
  close: () => void;
}

interface MediaStreamTrackProcessorInstance {
  readable: ReadableStream<VideoFrameLike>;
}

interface ImageCaptureInstance {
  grabFrame: () => Promise<ImageBitmap>;
}

const VIDEO_EVENTS = [
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'play',
  'playing',
  'error',
  'stalled',
  'abort',
  'emptied',
] as const;

const TRACK_EVENTS = ['mute', 'unmute', 'ended'] as const;

const PLAY_TIMEOUT_MS = 7000;
const DIRECT_CAPTURE_TIMEOUT_MS = 5000;
const TARGET_PROCESSOR_FRAMES = 5;
const TARGET_IMAGE_CAPTURE_FRAMES = 3;
const IMAGE_CAPTURE_INTERVAL_MS = 180;

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutLabel: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new DOMException(timeoutLabel, 'TimeoutError'));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export const IsolatedCameraTest: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const directCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const playTimeoutRef = useRef<number | null>(null);
  const testStartTimeRef = useRef<number>(0);
  const playAttemptIdRef = useRef<number>(0);
  const playStartedAtRef = useRef<number>(0);
  const playStateRef = useRef<PlayPromiseState>('idle');
  const directProbeIdRef = useRef<number>(0);
  const directCleanupRef = useRef<(() => void) | null>(null);
  const logSeqRef = useRef<number>(0);

  const [stage, setStage] = useState<TestStage>('idle');
  const [gumError, setGumError] = useState<GetUserMediaErrorInfo | null>(null);

  const [playState, setPlayState] = useState<PlayPromiseState>('idle');
  playStateRef.current = playState;
  const [playElapsedMs, setPlayElapsedMs] = useState<number | null>(null);
  const [playTimedOut, setPlayTimedOut] = useState<boolean>(false);
  const [playError, setPlayError] = useState<PlayErrorInfo | null>(null);

  const [diagnostics, setDiagnostics] = useState<LiveDiagnostics | null>(null);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

  // Прямая проверка кадров без HTMLVideoElement
  const [processorSupported, setProcessorSupported] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    typeof (window as unknown as { MediaStreamTrackProcessor?: unknown })
      .MediaStreamTrackProcessor === 'function'
  );
  const [imageCaptureSupported, setImageCaptureSupported] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === 'function'
  );
  const [isProbingDirect, setIsProbingDirect] = useState<boolean>(false);
  const [processorState, setProcessorState] = useState<ProbeMethodState>('idle');
  const [processorError, setProcessorError] = useState<ProbeErrorInfo | null>(null);
  const [imageCaptureState, setImageCaptureState] = useState<ProbeMethodState>('idle');
  const [imageCaptureError, setImageCaptureError] = useState<ProbeErrorInfo | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrameMeta[]>([]);
  const [canvasDrawnCount, setCanvasDrawnCount] = useState<number>(0);

  const appendLog = useCallback(
    (source: EventLogEntry['source'], event: string, detail = '') => {
      const elapsedMs = testStartTimeRef.current
        ? Math.round(performance.now() - testStartTimeRef.current)
        : 0;
      const entry: EventLogEntry = {
        id: ++logSeqRef.current,
        elapsedMs,
        source,
        event,
        detail,
      };
      setEventLog((prev) => [...prev.slice(-59), entry]);
    },
    []
  );

  const readLiveDiagnostics = useCallback((): LiveDiagnostics => {
    const video = videoRef.current;
    const stream = streamRef.current;
    const videoTracks = stream ? stream.getVideoTracks() : [];
    const primaryTrack = videoTracks[0] ?? null;

    return {
      videoIsConnected: video ? video.isConnected : false,
      srcObjectMatchesStream: Boolean(video && stream && video.srcObject === stream),
      videoPaused: video ? video.paused : null,
      videoReadyState: video ? video.readyState : 0,
      videoNetworkState: video ? video.networkState : 0,
      videoWidth: video ? video.videoWidth : 0,
      videoHeight: video ? video.videoHeight : 0,
      trackCount: videoTracks.length,
      deviceLabel: primaryTrack?.label || '(название не указано)',
      trackEnabled: primaryTrack ? primaryTrack.enabled : null,
      trackMuted: primaryTrack ? primaryTrack.muted : null,
      trackReadyState: primaryTrack ? primaryTrack.readyState : 'none',
      trackSettings: primaryTrack ? primaryTrack.getSettings() : null,
    };
  }, []);

  const stopDirectProbe = useCallback(() => {
    directProbeIdRef.current += 1;
    if (directCleanupRef.current) {
      directCleanupRef.current();
      directCleanupRef.current = null;
    }
    setIsProbingDirect(false);
  }, []);

  const clearTimersAndListeners = useCallback(() => {
    if (cleanupListenersRef.current) {
      cleanupListenersRef.current();
      cleanupListenersRef.current = null;
    }
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (playTimeoutRef.current !== null) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
  }, []);

  const stopTest = useCallback(() => {
    playAttemptIdRef.current += 1;
    stopDirectProbe();
    clearTimersAndListeners();

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    if (directCanvasRef.current) {
      const ctx = directCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, directCanvasRef.current.width, directCanvasRef.current.height);
    }

    setStage('idle');
    setGumError(null);
    setPlayState('idle');
    setPlayElapsedMs(null);
    setPlayTimedOut(false);
    setPlayError(null);
    setDiagnostics(null);
    setEventLog([]);
    setProcessorState('idle');
    setProcessorError(null);
    setImageCaptureState('idle');
    setImageCaptureError(null);
    setCapturedFrames([]);
    setCanvasDrawnCount(0);
  }, [clearTimersAndListeners, stopDirectProbe]);

  useEffect(() => {
    return () => {
      stopDirectProbe();
      clearTimersAndListeners();
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
    };
  }, [clearTimersAndListeners, stopDirectProbe]);

  const invokeControlledPlay = useCallback(
    (reason: string) => {
      const video = videoRef.current;
      const stream = streamRef.current;
      if (!video || !stream) return;

      if (playTimeoutRef.current !== null) {
        window.clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }

      const attemptId = ++playAttemptIdRef.current;
      const playStartedAt = performance.now();
      playStartedAtRef.current = playStartedAt;

      setPlayState('pending');
      setPlayElapsedMs(0);
      setPlayTimedOut(false);
      setPlayError(null);
      appendLog(
        'action',
        'video.play() вызван',
        `${reason} | isConnected=${String(video.isConnected)} | srcObject===stream=${String(
          video.srcObject === stream
        )}`
      );

      playTimeoutRef.current = window.setTimeout(() => {
        if (playAttemptIdRef.current !== attemptId) return;
        setPlayTimedOut(true);
        setPlayElapsedMs(Math.round(performance.now() - playStartedAt));
        setDiagnostics(readLiveDiagnostics());
        appendLog(
          'action',
          'Тайм-аут диагностики (> 7 с)',
          'Promise video.play() остаётся в состоянии pending'
        );
      }, PLAY_TIMEOUT_MS);

      let playPromise: Promise<void>;
      try {
        playPromise = video.play();
      } catch (syncErr) {
        if (playTimeoutRef.current !== null) {
          window.clearTimeout(playTimeoutRef.current);
          playTimeoutRef.current = null;
        }
        const e = syncErr as Error;
        const elapsed = Math.round(performance.now() - playStartedAt);
        setPlayState('rejected');
        setPlayElapsedMs(elapsed);
        setPlayError({
          name: e?.name || 'SyncPlayError',
          message: e?.message || String(syncErr),
        });
        setDiagnostics(readLiveDiagnostics());
        appendLog('action', 'video.play() rejected (sync)', `${e?.name}: ${e?.message}`);
        return;
      }

      playPromise.then(
        () => {
          if (playAttemptIdRef.current !== attemptId) return;
          if (playTimeoutRef.current !== null) {
            window.clearTimeout(playTimeoutRef.current);
            playTimeoutRef.current = null;
          }
          const elapsed = Math.round(performance.now() - playStartedAt);
          setPlayState('resolved');
          setPlayTimedOut(false);
          setPlayElapsedMs(elapsed);
          setPlayError(null);
          setDiagnostics(readLiveDiagnostics());
          appendLog('action', 'video.play() resolved', `за ${elapsed} мс`);
        },
        (err: unknown) => {
          if (playAttemptIdRef.current !== attemptId) return;
          if (playTimeoutRef.current !== null) {
            window.clearTimeout(playTimeoutRef.current);
            playTimeoutRef.current = null;
          }
          const e = err as Error;
          const elapsed = Math.round(performance.now() - playStartedAt);
          setPlayState('rejected');
          setPlayTimedOut(false);
          setPlayElapsedMs(elapsed);
          setPlayError({
            name: e?.name || 'PlaybackError',
            message: e?.message || String(err),
          });
          setDiagnostics(readLiveDiagnostics());
          appendLog(
            'action',
            'video.play() rejected',
            `${e?.name || 'Error'}: ${e?.message || String(err)} (${elapsed} мс)`
          );
        }
      );
    },
    [appendLog, readLiveDiagnostics]
  );

  const runIsolatedTest = async () => {
    stopTest();
    testStartTimeRef.current = performance.now();
    logSeqRef.current = 0;

    const videoBeforeGum = videoRef.current;
    appendLog(
      'action',
      'Старт теста',
      `video в DOM=${String(Boolean(videoBeforeGum))}, isConnected=${String(
        videoBeforeGum?.isConnected ?? false
      )}`
    );

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStage('getUserMedia_error');
      setGumError({
        stage: 'Проверка navigator.mediaDevices.getUserMedia',
        name: 'UnavailableAPI',
        message: `isSecureContext=${String(window.isSecureContext)}, mediaDevices=${String(
          Boolean(navigator.mediaDevices)
        )}`,
      });
      return;
    }

    // Этап 1: Прямой вызов getUserMedia без доп. ограничений
    setStage('requesting_stream');
    appendLog('action', 'Вызов getUserMedia', '{ video: true, audio: false }');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    } catch (err) {
      const e = err as Error & { constraint?: string };
      setStage('getUserMedia_error');
      setGumError({
        stage: 'getUserMedia({ video: true, audio: false })',
        name: e?.name || 'UnknownError',
        message: e?.message || String(err),
        constraint: typeof e?.constraint === 'string' && e.constraint ? e.constraint : undefined,
      });
      appendLog('action', 'getUserMedia ошибка', `${e?.name}: ${e?.message}`);
      return;
    }

    streamRef.current = stream;
    setStage('stream_ready');

    const videoTracks = stream.getVideoTracks();
    const primaryTrack = videoTracks[0] ?? null;
    appendLog(
      'action',
      'MediaStream получен',
      `дорожек=${videoTracks.length}, track.readyState=${primaryTrack?.readyState ?? 'none'}, track.muted=${String(
        primaryTrack?.muted ?? null
      )}`
    );

    const video = videoRef.current;
    if (!video || !video.isConnected) {
      setDiagnostics(readLiveDiagnostics());
      setPlayState('rejected');
      setPlayError({
        name: 'DisconnectedVideoElement',
        message: `video=${String(Boolean(video))}, isConnected=${String(
          video?.isConnected ?? false
        )}`,
      });
      appendLog('action', 'Ошибка DOM', 'video элемент отсутствует или отключён от DOM');
      return;
    }

    // Регистрация событий video и videoTrack до присваивания srcObject
    const onVideoEvent = (ev: Event) => {
      const extra =
        ev.type === 'error' && video.error
          ? ` | mediaError(code=${video.error.code}, msg=${video.error.message})`
          : '';
      appendLog(
        'video',
        ev.type,
        `readyState=${video.readyState}, networkState=${video.networkState}, ${video.videoWidth}×${video.videoHeight}${extra}`
      );
      setDiagnostics(readLiveDiagnostics());
    };

    const onTrackEvent = (ev: Event) => {
      const t = ev.target as MediaStreamTrack;
      appendLog(
        'track',
        ev.type,
        `readyState=${t.readyState}, muted=${String(t.muted)}, enabled=${String(t.enabled)}`
      );
      setDiagnostics(readLiveDiagnostics());
    };

    for (const evt of VIDEO_EVENTS) {
      video.addEventListener(evt, onVideoEvent);
    }
    if (primaryTrack) {
      for (const evt of TRACK_EVENTS) {
        primaryTrack.addEventListener(evt, onTrackEvent);
      }
    }

    cleanupListenersRef.current = () => {
      for (const evt of VIDEO_EVENTS) {
        video.removeEventListener(evt, onVideoEvent);
      }
      if (primaryTrack) {
        for (const evt of TRACK_EVENTS) {
          primaryTrack.removeEventListener(evt, onTrackEvent);
        }
      }
    };

    // Контролируемое подключение потока: без video.load() и без повторного сброса srcObject
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    const attachedOk = video.srcObject === stream;
    appendLog(
      'action',
      'srcObject присвоен',
      `video.srcObject === stream: ${String(attachedOk)}, isConnected=${String(video.isConnected)}`
    );
    setDiagnostics(readLiveDiagnostics());

    // Периодическое обновление живых метрик
    pollIntervalRef.current = window.setInterval(() => {
      setDiagnostics(readLiveDiagnostics());
      if (playStateRef.current === 'pending' && playStartedAtRef.current > 0) {
        setPlayElapsedMs(Math.round(performance.now() - playStartedAtRef.current));
      }
    }, 250);

    // Этап 2: Отдельный контролируемый вызов video.play()
    invokeControlledPlay('первичный запуск после srcObject');
  };

  const handleRetryPlay = () => {
    invokeControlledPlay('ручной повтор («Повторить воспроизведение»)');
  };

  const drawSourceToCanvas = useCallback(
    (source: CanvasImageSource, width: number, height: number): boolean => {
      const canvas = directCanvasRef.current;
      if (!canvas || width <= 0 || height <= 0) return false;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(source, 0, 0, width, height);
      setCanvasDrawnCount((prev) => prev + 1);
      return true;
    },
    []
  );

  const runDirectFrameProbe = async () => {
    const stream = streamRef.current;
    const sourceTrack = stream?.getVideoTracks()[0];
    if (!stream || !sourceTrack || sourceTrack.readyState !== 'live') {
      appendLog(
        'direct',
        'Запуск невозможен',
        'Нет активной видеодорожки. Сначала нажмите «Проверить камеру отдельно».'
      );
      return;
    }

    stopDirectProbe();
    const probeId = ++directProbeIdRef.current;
    setIsProbingDirect(true);
    setProcessorError(null);
    setImageCaptureError(null);
    setCapturedFrames([]);
    setCanvasDrawnCount(0);

    const ProcessorCtor = (
      window as unknown as {
        MediaStreamTrackProcessor?: new (init: {
          track: MediaStreamTrack;
        }) => MediaStreamTrackProcessorInstance;
      }
    ).MediaStreamTrackProcessor;

    const ImageCaptureCtor = (
      window as unknown as {
        ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureInstance;
      }
    ).ImageCapture;

    const hasProcessor = typeof ProcessorCtor === 'function';
    const hasImageCapture = typeof ImageCaptureCtor === 'function';
    setProcessorSupported(hasProcessor);
    setImageCaptureSupported(hasImageCapture);

    appendLog(
      'direct',
      'Старт прямого чтения кадров',
      `MediaStreamTrackProcessor=${String(hasProcessor)}, ImageCapture=${String(hasImageCapture)}`
    );

    let processorSucceeded = false;

    // Попытка 1: MediaStreamTrackProcessor (минимум 5 последовательных VideoFrame)
    if (!hasProcessor) {
      setProcessorState('unsupported');
      appendLog('direct', 'MediaStreamTrackProcessor', 'API не поддерживается браузером');
    } else {
      setProcessorState('running');
      let clonedTrack: MediaStreamTrack | null = null;
      let reader: ReadableStreamDefaultReader<VideoFrameLike> | null = null;

      const releaseProcessorResources = () => {
        if (reader) {
          const r = reader;
          reader = null;
          r.cancel()
            .catch(() => {})
            .finally(() => {
              try {
                r.releaseLock();
              } catch {
                // ignore
              }
            });
        }
        if (clonedTrack) {
          clonedTrack.stop();
          clonedTrack = null;
        }
      };

      directCleanupRef.current = releaseProcessorResources;

      try {
        clonedTrack = sourceTrack.clone();
        const processor = new ProcessorCtor!({ track: clonedTrack });
        reader = processor.readable.getReader();

        let prevArrivalTime: number | null = null;
        let receivedCount = 0;

        while (receivedCount < TARGET_PROCESSOR_FRAMES) {
          if (directProbeIdRef.current !== probeId) break;

          const readResult = await raceWithTimeout(
            reader.read(),
            DIRECT_CAPTURE_TIMEOUT_MS,
            `Тайм-аут чтения VideoFrame #${receivedCount + 1} (> 5 с)`
          );

          if (directProbeIdRef.current !== probeId) {
            if (readResult.value) readResult.value.close();
            break;
          }

          if (readResult.done || !readResult.value) {
            throw new DOMException(
              'Поток MediaStreamTrackProcessor завершился (done=true) до получения 5 кадров.',
              'AbortError'
            );
          }

          const frame = readResult.value;
          try {
            const now = performance.now();
            const deltaMs =
              prevArrivalTime !== null ? Math.round(now - prevArrivalTime) : null;
            prevArrivalTime = now;

            const w = frame.displayWidth || frame.codedWidth || 0;
            const h = frame.displayHeight || frame.codedHeight || 0;
            const ts = typeof frame.timestamp === 'number' ? frame.timestamp : null;

            drawSourceToCanvas(frame as unknown as CanvasImageSource, w, h);
            receivedCount += 1;

            const meta: CapturedFrameMeta = {
              index: receivedCount,
              source: 'MediaStreamTrackProcessor',
              width: w,
              height: h,
              timestamp: ts,
              deltaMs,
            };
            setCapturedFrames((prev) => [...prev, meta]);
            appendLog(
              'direct',
              `VideoFrame #${receivedCount}`,
              `${w}×${h}, ts=${ts ?? 'n/a'}, Δt=${deltaMs !== null ? `${deltaMs} мс` : '—'}`
            );
          } finally {
            frame.close();
          }
        }

        if (directProbeIdRef.current === probeId && receivedCount >= TARGET_PROCESSOR_FRAMES) {
          processorSucceeded = true;
          setProcessorState('success');
          setImageCaptureState('skipped');
          appendLog(
            'direct',
            'MediaStreamTrackProcessor завершён',
            `получено ${receivedCount} кадров`
          );
        }
      } catch (err) {
        if (directProbeIdRef.current === probeId) {
          const e = err as Error;
          const name = e?.name || 'ProcessorError';
          const message = e?.message || String(err);
          setProcessorState(name === 'TimeoutError' ? 'timeout' : 'error');
          setProcessorError({ name, message });
          appendLog('direct', 'MediaStreamTrackProcessor ошибка', `${name}: ${message}`);
        }
      } finally {
        releaseProcessorResources();
        if (directCleanupRef.current === releaseProcessorResources) {
          directCleanupRef.current = null;
        }
      }
    }

    if (directProbeIdRef.current !== probeId) return;

    // Попытка 2 (запасной вариант): ImageCapture(track).grabFrame() — 3 кадра
    if (!processorSucceeded) {
      if (!hasImageCapture) {
        setImageCaptureState('unsupported');
        appendLog('direct', 'ImageCapture', 'API не поддерживается браузером');
      } else {
        setImageCaptureState('running');
        let icTrack: MediaStreamTrack | null = null;

        const releaseImageCaptureResources = () => {
          if (icTrack) {
            icTrack.stop();
            icTrack = null;
          }
        };
        directCleanupRef.current = releaseImageCaptureResources;

        try {
          icTrack = sourceTrack.clone();
          const imageCapture = new ImageCaptureCtor!(icTrack);
          let prevArrivalTime: number | null = null;

          for (let i = 1; i <= TARGET_IMAGE_CAPTURE_FRAMES; i++) {
            if (directProbeIdRef.current !== probeId) break;

            const bitmap = await raceWithTimeout(
              imageCapture.grabFrame(),
              DIRECT_CAPTURE_TIMEOUT_MS,
              `Тайм-аут ImageCapture.grabFrame() #${i} (> 5 с)`
            );

            try {
              if (directProbeIdRef.current !== probeId) break;

              const now = performance.now();
              const deltaMs =
                prevArrivalTime !== null ? Math.round(now - prevArrivalTime) : null;
              prevArrivalTime = now;

              const w = bitmap.width;
              const h = bitmap.height;
              drawSourceToCanvas(bitmap, w, h);

              const meta: CapturedFrameMeta = {
                index: i,
                source: 'ImageCapture',
                width: w,
                height: h,
                timestamp: null,
                deltaMs,
              };
              setCapturedFrames((prev) => [...prev, meta]);
              appendLog(
                'direct',
                `ImageBitmap #${i}`,
                `${w}×${h}, Δt=${deltaMs !== null ? `${deltaMs} мс` : '—'}`
              );
            } finally {
              bitmap.close();
            }

            if (i < TARGET_IMAGE_CAPTURE_FRAMES && directProbeIdRef.current === probeId) {
              await new Promise((r) => window.setTimeout(r, IMAGE_CAPTURE_INTERVAL_MS));
            }
          }

          if (directProbeIdRef.current === probeId) {
            setImageCaptureState('success');
            appendLog(
              'direct',
              'ImageCapture завершён',
              `получено ${TARGET_IMAGE_CAPTURE_FRAMES} ImageBitmap`
            );
          }
        } catch (err) {
          if (directProbeIdRef.current === probeId) {
            const e = err as Error;
            const name = e?.name || 'ImageCaptureError';
            const message = e?.message || String(err);
            setImageCaptureState(name === 'TimeoutError' ? 'timeout' : 'error');
            setImageCaptureError({ name, message });
            appendLog('direct', 'ImageCapture ошибка', `${name}: ${message}`);
          }
        } finally {
          releaseImageCaptureResources();
          if (directCleanupRef.current === releaseImageCaptureResources) {
            directCleanupRef.current = null;
          }
        }
      }
    }

    if (directProbeIdRef.current === probeId) {
      setIsProbingDirect(false);
    }
  };

  const hasStream = Boolean(streamRef.current);

  return (
    <section
      aria-label="Изолированная диагностика физической веб-камеры"
      className="mt-6 rounded-2xl bg-white border border-slate-200 p-5 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Независимый тест веб-камеры (временный)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Прямой вызов <code className="font-mono">getUserMedia(&#123; video: true, audio: false &#125;)</code>, трассировка <code className="font-mono">HTMLVideoElement</code> и прямое чтение кадров из дорожки на Canvas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runIsolatedTest}
            disabled={stage === 'requesting_stream'}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5 shrink-0" />
            <span>Проверить камеру отдельно</span>
          </button>

          <button
            type="button"
            onClick={handleRetryPlay}
            disabled={!hasStream}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 shrink-0" />
            <span>Повторить воспроизведение</span>
          </button>

          <button
            type="button"
            onClick={runDirectFrameProbe}
            disabled={!hasStream || isProbingDirect}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isProbingDirect
                ? 'Чтение кадров...'
                : 'Проверить получение кадров напрямую'}
            </span>
          </button>

          {(hasStream || stage !== 'idle') && (
            <button
              type="button"
              onClick={stopTest}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5 shrink-0" />
              <span>Остановить тест</span>
            </button>
          )}
        </div>
      </div>

      {/* Видимый <video> и видимый <canvas> для прямого захвата */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_300px_1fr] gap-5 items-start">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">1. HTML &lt;video&gt;</div>
          <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-200">
            <video
              ref={videoRef}
              playsInline
              muted
              className="block h-full w-full object-cover bg-slate-950"
            />
          </div>
          <p className="text-[11px] text-slate-500 font-mono">
            Всегда видим в DOM (без autoPlay и display:none)
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-700">
              2. Canvas (напрямую без &lt;video&gt;)
            </span>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              кадров: {canvasDrawnCount}
            </span>
          </div>
          <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-200">
            <canvas
              ref={directCanvasRef}
              width={320}
              height={240}
              className="block h-full w-full object-contain bg-slate-950"
            />
          </div>
          <p className="text-[11px] text-slate-500 font-mono">
            VideoFrame (Processor) / ImageBitmap (ImageCapture)
          </p>
        </div>

        {/* Подробная диагностика */}
        <div className="space-y-4 text-xs">
          {/* Состояние потока и HTMLVideoElement */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">Состояние потока и video</span>
              <span className="font-mono text-[11px] text-slate-600">{stage}</span>
            </div>

            {diagnostics ? (
              <div className="space-y-2.5">
                <dl className="grid grid-cols-[195px_1fr] gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
                  <dt className="font-sans text-slate-500">Устройство</dt>
                  <dd className="text-slate-900 break-words">{diagnostics.deviceLabel}</dd>

                  <dt className="font-sans text-slate-500">video.isConnected</dt>
                  <dd className={diagnostics.videoIsConnected ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                    {String(diagnostics.videoIsConnected)}
                  </dd>

                  <dt className="font-sans text-slate-500">video.srcObject === stream</dt>
                  <dd className={diagnostics.srcObjectMatchesStream ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                    {String(diagnostics.srcObjectMatchesStream)}
                  </dd>

                  <dt className="font-sans text-slate-500">video.paused</dt>
                  <dd className="text-slate-900">{String(diagnostics.videoPaused)}</dd>

                  <dt className="font-sans text-slate-500">video.readyState / networkState</dt>
                  <dd className="text-slate-900">
                    {diagnostics.videoReadyState} / {diagnostics.videoNetworkState}
                  </dd>

                  <dt className="font-sans text-slate-500">videoWidth × videoHeight</dt>
                  <dd className="text-slate-900">
                    {diagnostics.videoWidth} × {diagnostics.videoHeight}
                  </dd>

                  <dt className="font-sans text-slate-500">Видеодорожек / readyState</dt>
                  <dd className="text-slate-900">
                    {diagnostics.trackCount} / {diagnostics.trackReadyState}
                  </dd>

                  <dt className="font-sans text-slate-500">track.enabled / muted</dt>
                  <dd className={diagnostics.trackMuted ? 'text-amber-700 font-semibold' : 'text-slate-900'}>
                    {String(diagnostics.trackEnabled)} / {String(diagnostics.trackMuted)}
                  </dd>

                  <dt className="font-sans text-slate-500">Promise video.play()</dt>
                  <dd
                    className={
                      playState === 'resolved'
                        ? 'text-emerald-700 font-semibold'
                        : playState === 'rejected'
                          ? 'text-red-700 font-semibold'
                          : 'text-amber-700 font-semibold'
                    }
                  >
                    {playState}
                    {playElapsedMs !== null ? ` (${playElapsedMs} мс)` : ''}
                  </dd>
                </dl>

                {playState === 'pending' && playTimedOut && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-950">
                    Тайм-аут диагностики (&gt; 7 с): Promise <code className="font-mono">video.play()</code> всё ещё в состоянии <code className="font-mono">pending</code>.
                  </div>
                )}

                {playState === 'rejected' && playError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 space-y-0.5 text-[11px] text-red-950">
                    <div className="font-semibold">Ошибка video.play() (rejected)</div>
                    <div className="font-mono">error.name: {playError.name}</div>
                    <div className="font-mono break-words">error.message: {playError.message}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500">
                Нажмите «Проверить камеру отдельно», затем «Проверить получение кадров напрямую».
              </p>
            )}

            {gumError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1 text-[11px] text-red-950">
                <div className="font-semibold">
                  Ошибка getUserMedia ({gumError.stage})
                </div>
                <div className="font-mono">error.name: {gumError.name}</div>
                <div className="font-mono break-words">error.message: {gumError.message}</div>
                {gumError.constraint && (
                  <div className="font-mono">error.constraint: {gumError.constraint}</div>
                )}
              </div>
            )}
          </div>

          {/* Диагностика прямого захвата кадров */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
            <div className="font-semibold text-slate-900">
              Прямое чтение кадров (без HTMLVideoElement)
            </div>

            <dl className="grid grid-cols-[215px_1fr] gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
              <dt className="font-sans text-slate-500">MediaStreamTrackProcessor</dt>
              <dd className="text-slate-900">
                {processorSupported ? 'поддерживается' : 'не поддерживается'} ·{' '}
                <span className="font-semibold">{processorState}</span>
              </dd>

              <dt className="font-sans text-slate-500">ImageCapture (grabFrame)</dt>
              <dd className="text-slate-900">
                {imageCaptureSupported ? 'поддерживается' : 'не поддерживается'} ·{' '}
                <span className="font-semibold">{imageCaptureState}</span>
              </dd>

              <dt className="font-sans text-slate-500">Отрисовано на Canvas</dt>
              <dd className={canvasDrawnCount > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-900'}>
                {canvasDrawnCount}
              </dd>
            </dl>

            {processorError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2 space-y-0.5 text-[11px] text-red-950">
                <div className="font-semibold">Ошибка MediaStreamTrackProcessor</div>
                <div className="font-mono">error.name: {processorError.name}</div>
                <div className="font-mono break-words">error.message: {processorError.message}</div>
              </div>
            )}

            {imageCaptureError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2 space-y-0.5 text-[11px] text-red-950">
                <div className="font-semibold">Ошибка ImageCapture</div>
                <div className="font-mono">error.name: {imageCaptureError.name}</div>
                <div className="font-mono break-words">error.message: {imageCaptureError.message}</div>
              </div>
            )}

            {capturedFrames.length > 0 && (
              <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-left font-mono text-[11px] tabular-nums">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1">#</th>
                      <th className="px-2 py-1">Источник</th>
                      <th className="px-2 py-1">Размер</th>
                      <th className="px-2 py-1">Timestamp</th>
                      <th className="px-2 py-1">Δt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capturedFrames.map((f) => (
                      <tr key={`${f.source}-${f.index}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2 py-1">{f.index}</td>
                        <td className="px-2 py-1">{f.source === 'MediaStreamTrackProcessor' ? 'Processor' : 'ImageCapture'}</td>
                        <td className="px-2 py-1">{f.width}×{f.height}</td>
                        <td className="px-2 py-1">{f.timestamp !== null ? f.timestamp : '—'}</td>
                        <td className="px-2 py-1">{f.deltaMs !== null ? `${f.deltaMs} мс` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Нижняя строка: getSettings() и журнал событий */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
          <div className="font-semibold text-slate-900">track.getSettings()</div>
          {diagnostics?.trackSettings ? (
            <pre className="max-h-40 overflow-auto rounded-lg bg-white border border-slate-200 p-2 font-mono text-[11px] text-slate-800">
              {JSON.stringify(diagnostics.trackSettings, null, 2)}
            </pre>
          ) : (
            <p className="text-[11px] text-slate-500">Настройки появятся после получения потока.</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              Журнал событий (video, track, прямой захват)
            </span>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {eventLog.length}
            </span>
          </div>

          {eventLog.length === 0 ? (
            <p className="text-slate-500 text-[11px]">
              События появятся после запуска теста.
            </p>
          ) : (
            <div className="max-h-40 overflow-auto rounded-lg bg-white border border-slate-200 p-2 space-y-1 font-mono text-[11px]">
              {eventLog.map((entry) => (
                <div
                  key={entry.id}
                  className="border-b border-slate-100 last:border-b-0 pb-1 last:pb-0"
                >
                  <span className="text-slate-400">+{entry.elapsedMs}ms</span>{' '}
                  <span
                    className={
                      entry.source === 'video'
                        ? 'text-blue-700 font-semibold'
                        : entry.source === 'track'
                          ? 'text-amber-700 font-semibold'
                          : entry.source === 'direct'
                            ? 'text-emerald-700 font-semibold'
                            : 'text-slate-800 font-semibold'
                    }
                  >
                    [{entry.source}:{entry.event}]
                  </span>
                  {entry.detail && (
                    <span className="text-slate-600"> — {entry.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
