import React from 'react';
import { Camera, CameraOff, RotateCcw } from 'lucide-react';
import type { CameraStatus, TrackingSettings } from '../types/tracking';

interface ControlPanelProps {
  status: CameraStatus;
  settings: TrackingSettings;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onChangeSettings: (next: Partial<TrackingSettings>) => void;
  onResetSettings: () => void;
}

const LIGHTING_PRESETS: Array<{ label: string; sensitivity: number }> = [
  { label: 'Ярко', sensitivity: 35 },
  { label: 'Обычно', sensitivity: 55 },
  { label: 'Темно', sensitivity: 80 },
];

export const ControlPanel: React.FC<ControlPanelProps> = ({
  status,
  settings,
  onStartCamera,
  onStopCamera,
  onChangeSettings,
  onResetSettings,
}) => {
  const isRunning =
    status === 'starting' || status === 'no_object' || status === 'detected';

  return (
    <div className="space-y-5">
      {/* Camera start / stop primary action */}
      <div>
        {isRunning ? (
          <button
            type="button"
            onClick={onStopCamera}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 whitespace-nowrap"
          >
            <CameraOff className="w-4 h-4 shrink-0" />
            <span>Выключить камеру</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartCamera}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 whitespace-nowrap"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>Включить камеру</span>
          </button>
        )}
      </div>

      <div className="h-px bg-slate-200" />

      {/* Sensitivity calibration */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Настройка распознавания</h2>
          <button
            type="button"
            onClick={onResetSettings}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Сброс</span>
          </button>
        </div>

        {/* Quick lighting presets */}
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-slate-600">
            Освещение в комнате
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-100">
            {LIGHTING_PRESETS.map((preset) => {
              const active = Math.abs(settings.sensitivity - preset.sensitivity) <= 6;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChangeSettings({ sensitivity: preset.sensitivity })}
                  className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sensitivity slider */}
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">Чувствительность зелёного</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {settings.sensitivity}%
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={settings.sensitivity}
            onChange={(e) =>
              onChangeSettings({ sensitivity: Number(e.target.value) })
            }
            className="w-full accent-emerald-600 cursor-pointer"
          />
          <p className="text-[11px] text-slate-500 leading-snug">
            Увеличьте при тусклом свете или светло-зелёном предмете; уменьшите, если фон даёт помехи.
          </p>
        </label>

        {/* Smoothing slider */}
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">Сглаживание движений</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {Math.round(settings.smoothing * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={Math.round(settings.smoothing * 100)}
            onChange={(e) =>
              onChangeSettings({ smoothing: Number(e.target.value) / 100 })
            }
            className="w-full accent-emerald-600 cursor-pointer"
          />
        </label>

        {/* Minimum region size slider */}
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">Мин. размер предмета</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {settings.minAreaPercent.toFixed(1)}%
            </span>
          </div>
          <input
            type="range"
            min={0.2}
            max={3.5}
            step={0.1}
            value={settings.minAreaPercent}
            onChange={(e) =>
              onChangeSettings({ minAreaPercent: Number(e.target.value) })
            }
            className="w-full accent-emerald-600 cursor-pointer"
          />
        </label>

        {/* Mask overlay toggle */}
        <label className="flex items-center justify-between gap-3 pt-1 cursor-pointer">
          <span className="text-xs font-medium text-slate-700">
            Подсветка зелёного на предпросмотре
          </span>
          <input
            type="checkbox"
            checked={settings.showMaskOverlay}
            onChange={(e) =>
              onChangeSettings({ showMaskOverlay: e.target.checked })
            }
            className="h-4 w-4 rounded accent-emerald-600 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
};
