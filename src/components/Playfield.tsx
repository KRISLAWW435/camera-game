import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, ExternalLink, Search, ShieldAlert } from 'lucide-react';
import type {
  CameraEnvironmentInfo,
  CameraErrorDetails,
  CameraStatus,
} from '../types/tracking';

interface PlayfieldProps {
  status: CameraStatus;
  errorDetails: CameraErrorDetails | null;
  envInfo: CameraEnvironmentInfo;
  position: { x: number; y: number } | null;
  areaPercent: number;
  onStartCamera: () => void;
}

const CIRCLE_SIZE = 72;
const EDGE_PADDING = CIRCLE_SIZE / 2 + 12;

export const Playfield: React.FC<PlayfieldProps> = ({
  status,
  errorDetails,
  envInfo,
  position,
  areaPercent,
  onStartCamera,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 560 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const usableWidth = Math.max(0, size.width - EDGE_PADDING * 2);
  const usableHeight = Math.max(0, size.height - EDGE_PADDING * 2);

  const circleCenterX = position
    ? EDGE_PADDING + position.x * usableWidth
    : size.width / 2;
  const circleCenterY = position
    ? EDGE_PADDING + position.y * usableHeight
    : size.height / 2;

  const isDetected = status === 'detected' && position !== null;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div
      ref={containerRef}
      aria-label="Игровое поле отслеживания зелёного круга"
      className="relative w-full h-full min-h-[420px] lg:min-h-[600px] overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 select-none"
    >
      {/* Subtle geometric dot grid for spatial orientation */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: 'radial-gradient(circle, #64748b 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Subtle center axis lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-slate-800/80"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-slate-800/80"
      />

      {/* Active bright green circle controlled in mirror mode */}
      <div
        style={{
          width: `${CIRCLE_SIZE}px`,
          height: `${CIRCLE_SIZE}px`,
          transform: `translate3d(${circleCenterX - CIRCLE_SIZE / 2}px, ${
            circleCenterY - CIRCLE_SIZE / 2
          }px, 0) scale(${isDetected ? 1 : 0.75})`,
          opacity: isDetected ? 1 : 0,
        }}
        className="pointer-events-none absolute top-0 left-0 will-change-transform transition-[opacity] duration-150"
      >
        <div className="absolute -inset-3 rounded-full bg-emerald-400/20" />
        <div className="relative h-full w-full rounded-full bg-emerald-400 border-4 border-white shadow-[0_0_28px_rgba(74,222,128,0.55)]">
          <div className="absolute top-2.5 left-3 h-3.5 w-3.5 rounded-full bg-white/60" />
        </div>
      </div>

      {/* Helpful centered guidance when camera is off or waiting for green object */}
      {status === 'off' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-sm space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
              <Camera className="h-7 w-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="font-display text-xl font-semibold text-white">
                Игровое поле готово
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Включите веб-камеру и возьмите любой зелёный предмет. Зелёный круг на этом поле будет зеркально повторять ваши движения.
              </p>
            </div>
            <button
              type="button"
              onClick={onStartCamera}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 whitespace-nowrap"
            >
              <Camera className="h-4 w-4" />
              <span>Включить камеру</span>
            </button>
          </div>
        </div>
      )}

      {status === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="text-sm font-medium text-slate-300">
            Ожидаем включения веб-камеры…
          </p>
        </div>
      )}

      {(status === 'denied' || status === 'error') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-3">
            <div
              className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full border ${
                status === 'denied'
                  ? 'bg-red-950/70 text-red-400 border-red-900'
                  : 'bg-amber-950/70 text-amber-400 border-amber-900'
              }`}
            >
              {status === 'denied' ? (
                <ShieldAlert className="h-6 w-6" />
              ) : (
                <AlertTriangle className="h-6 w-6" />
              )}
            </div>
            <h2 className="font-display text-lg font-semibold text-white">
              {status === 'denied'
                ? 'Доступ к камере запрещён'
                : 'Ошибка запуска веб-камеры'}
            </h2>
            {errorDetails && (
              <p className="font-mono text-xs text-amber-300">
                Ошибка: {errorDetails.name}
              </p>
            )}
            <p className="text-sm text-slate-300 leading-relaxed">
              {errorDetails?.explanation ??
                'Не удалось получить доступ к камере. Проверьте разрешения браузера.'}
            </p>
            {envInfo.inIframe && pageUrl && (
              <div className="pt-1">
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  <span>Открыть приложение в новой вкладке</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {status === 'no_object' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-xs space-y-2 rounded-2xl bg-slate-900/80 px-5 py-4 border border-slate-800">
            <Search className="mx-auto h-6 w-6 text-amber-300" />
            <p className="text-sm font-semibold text-white">Предмет не найден</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              Подержите зелёный предмет перед камерой. Если он не виден, увеличьте чувствительность.
            </p>
          </div>
        </div>
      )}

      {/* Unobtrusive bottom-left corner readout only while object is actively tracked */}
      {isDetected && position && (
        <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-3 text-xs font-mono tabular-nums text-slate-400">
          <span>X: {Math.round(position.x * 100)}%</span>
          <span aria-hidden="true">·</span>
          <span>Y: {Math.round(position.y * 100)}%</span>
          <span aria-hidden="true">·</span>
          <span>Площадь: {areaPercent.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
};
