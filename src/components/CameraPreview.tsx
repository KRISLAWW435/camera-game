import React from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  ExternalLink,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type {
  CameraEnvironmentInfo,
  CameraErrorDetails,
  CameraStatus,
  StreamDiagnostics,
  TrackingResult,
} from '../types/tracking';

interface CameraPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  status: CameraStatus;
  errorDetails: CameraErrorDetails | null;
  envInfo: CameraEnvironmentInfo;
  streamDiagnostics: StreamDiagnostics;
  tracking: TrackingResult;
  showMaskOverlay: boolean;
  onRetry: () => void;
}

const STATUS_META: Record<
  CameraStatus,
  { label: string; toneClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  off: {
    label: 'Камера выключена',
    toneClass: 'text-slate-600',
    Icon: CameraOff,
  },
  starting: {
    label: 'Подключение камеры...',
    toneClass: 'text-slate-700',
    Icon: Camera,
  },
  denied: {
    label: 'Доступ запрещён',
    toneClass: 'text-red-700',
    Icon: ShieldAlert,
  },
  error: {
    label: 'Ошибка камеры',
    toneClass: 'text-amber-700',
    Icon: AlertTriangle,
  },
  no_object: {
    label: 'Предмет не найден',
    toneClass: 'text-amber-700',
    Icon: Search,
  },
  detected: {
    label: 'Предмет обнаружен',
    toneClass: 'text-emerald-700',
    Icon: CheckCircle2,
  },
};

export const CameraPreview: React.FC<CameraPreviewProps> = ({
  videoRef,
  maskCanvasRef,
  status,
  errorDetails,
  envInfo,
  streamDiagnostics,
  tracking,
  showMaskOverlay,
  onRetry,
}) => {
  const isStreamActive = status === 'no_object' || status === 'detected';
  const meta = STATUS_META[status];
  const StatusIcon = meta.Icon;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Предпросмотр камеры</h2>
        <div
          className={`flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${meta.toneClass}`}
        >
          <StatusIcon className="w-3.5 h-3.5 shrink-0" />
          <span>{meta.label}</span>
        </div>
      </div>

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-900 border border-slate-200">
        {/* Live mirrored video element (kept mounted so srcObject attaches reliably) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover -scale-x-100 transition-opacity duration-200 ${
            isStreamActive ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Mirrored HSV mask overlay */}
        <canvas
          ref={maskCanvasRef}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover -scale-x-100 transition-opacity duration-150 ${
            isStreamActive && showMaskOverlay ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Mirrored detection bounding box and centroid crosshair */}
        {isStreamActive && tracking.detected && tracking.box && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <rect
              x={tracking.box.minX * 100}
              y={tracking.box.minY * 100}
              width={(tracking.box.maxX - tracking.box.minX) * 100}
              height={(tracking.box.maxY - tracking.box.minY) * 100}
              fill="none"
              stroke="#4ade80"
              strokeWidth="0.9"
              vectorEffect="non-scaling-stroke"
              rx="1.5"
            />
            <circle
              cx={tracking.x * 100}
              cy={tracking.y * 100}
              r="2.2"
              fill="#22c55e"
              stroke="#ffffff"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {/* Inactive / Denied / Error overlays */}
        {status === 'off' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-100 text-slate-600">
            <CameraOff className="w-7 h-7 mb-2 text-slate-400" />
            <p className="text-sm font-medium text-slate-800">Камера выключена</p>
            <p className="mt-1 text-xs text-slate-500">
              Нажмите «Включить камеру», чтобы начать отслеживание
            </p>
          </div>
        )}

        {status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-900 text-slate-200">
            <Camera className="w-7 h-7 mb-2 text-slate-300" />
            <p className="text-sm font-medium">Запрос доступа к камере…</p>
            <p className="mt-1 text-xs text-slate-400">
              Подтвердите разрешение в окне браузера
            </p>
          </div>
        )}

        {(status === 'denied' || status === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-slate-900 text-slate-100">
            {status === 'denied' ? (
              <ShieldAlert className="w-7 h-7 mb-2 text-red-400" />
            ) : (
              <AlertTriangle className="w-7 h-7 mb-2 text-amber-400" />
            )}
            <p className="text-sm font-semibold">
              {status === 'denied' ? 'Доступ к камере запрещён' : 'Не удалось запустить камеру'}
            </p>
            {errorDetails && (
              <p className="mt-1 font-mono text-[11px] text-amber-300">
                {errorDetails.name}
              </p>
            )}
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-900 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white whitespace-nowrap"
            >
              Повторить
            </button>
          </div>
        )}

        {/* Subtle bottom contrast scrim when video is active and object isn't found yet */}
        {status === 'no_object' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 py-2">
            <p className="text-xs font-medium text-amber-200">
              Покажите зелёный предмет в кадре
            </p>
          </div>
        )}
      </div>

      {/* Active stream metadata */}
      {isStreamActive && streamDiagnostics.hasStream && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
          <span className="truncate">{streamDiagnostics.trackLabel ?? 'Веб-камера'}</span>
          <span className="shrink-0">{streamDiagnostics.resolution ?? '—'}</span>
        </div>
      )}

      {/* Always-visible temporary diagnostic block */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs text-slate-700">
        <div className="font-semibold text-slate-900">Диагностика камеры</div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[11px] font-mono tabular-nums">
          <dt className="text-slate-500 font-sans">API камеры (getUserMedia)</dt>
          <dd className={envInfo.hasGetUserMedia ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
            {envInfo.hasGetUserMedia ? 'доступен' : 'недоступен'}
          </dd>

          <dt className="text-slate-500 font-sans">Безопасный контекст</dt>
          <dd className={envInfo.isSecureContext ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
            {envInfo.isSecureContext ? 'true (HTTPS/localhost)' : 'false'}
          </dd>

          <dt className="text-slate-500 font-sans">Среда предпросмотра (iframe)</dt>
          <dd className="text-slate-800">
            {envInfo.inIframe ? 'да' : 'нет'} · policy:{' '}
            {envInfo.permissionsPolicyAllowed === null
              ? 'n/a'
              : envInfo.permissionsPolicyAllowed
                ? 'allow'
                : 'block'}
          </dd>

          <dt className="text-slate-500 font-sans">Видеопоток (srcObject)</dt>
          <dd className={streamDiagnostics.hasStream ? 'text-emerald-700 font-medium' : 'text-slate-700'}>
            {streamDiagnostics.hasStream ? 'получен' : 'нет'}
          </dd>

          <dt className="text-slate-500 font-sans">Активные видеодорожки</dt>
          <dd className="text-slate-900 font-medium">{streamDiagnostics.activeVideoTracks}</dd>

          <dt className="text-slate-500 font-sans">Воспроизведение / кадры</dt>
          <dd className="text-slate-800">
            {streamDiagnostics.videoPlaying ? 'play' : 'стоп'} /{' '}
            {streamDiagnostics.firstFrameReceived ? 'кадры идут' : 'нет кадров'}
          </dd>
        </dl>

        {errorDetails && (
          <div className="pt-1.5 mt-1 border-t border-slate-200 space-y-1">
            <div className="font-mono text-[11px] font-semibold text-red-700">
              Ошибка: {errorDetails.name}
            </div>
            <p className="text-[11px] text-slate-600 leading-snug">
              {errorDetails.explanation}
            </p>
            {errorDetails.message && (
              <p className="font-mono text-[10px] text-slate-500 break-words">
                {errorDetails.message}
              </p>
            )}
          </div>
        )}

        {envInfo.inIframe && pageUrl && (
          <div className="pt-1">
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
            >
              <span>Открыть в отдельной вкладке</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
