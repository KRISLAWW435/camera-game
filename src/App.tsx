import { CameraPreview } from './components/CameraPreview';
import { ControlPanel } from './components/ControlPanel';
import { IsolatedCameraTest } from './components/IsolatedCameraTest';
import { Playfield } from './components/Playfield';
import { useGreenTracking } from './hooks/useGreenTracking';

const STATUS_SUMMARY: Record<string, string> = {
  off: 'Камера выключена',
  starting: 'Подключение камеры',
  denied: 'Доступ запрещён',
  error: 'Ошибка камеры',
  no_object: 'Предмет не найден',
  detected: 'Предмет обнаружен',
};

export default function App() {
  const {
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
  } = useGreenTracking();

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f6f8] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-5 py-3.5 sm:px-8">
          <h1 className="font-display text-lg font-semibold tracking-tight text-slate-900 whitespace-nowrap">
            Трекер зелёного предмета
          </h1>
          <div className="flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
            <span className="hidden sm:inline">Локальное HSV-распознавание</span>
            <span className="hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="font-medium text-slate-900">{STATUS_SUMMARY[status]}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex-1 w-full max-w-[1400px] px-4 py-5 sm:px-8 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-stretch">
          <section aria-label="Игровая область" className="flex">
            <Playfield
              status={status}
              errorDetails={errorDetails}
              envInfo={envInfo}
              position={smoothedPosition}
              areaPercent={tracking.areaPercent}
              onStartCamera={startCamera}
            />
          </section>

          <aside
            aria-label="Управление камерой и чувствительностью"
            className="rounded-2xl bg-white border border-slate-200 p-5 space-y-5 flex flex-col justify-between"
          >
            <div className="space-y-5">
              <CameraPreview
                videoRef={videoRef}
                maskCanvasRef={maskCanvasRef}
                status={status}
                errorDetails={errorDetails}
                envInfo={envInfo}
                streamDiagnostics={streamDiagnostics}
                tracking={tracking}
                showMaskOverlay={settings.showMaskOverlay}
                onRetry={startCamera}
              />

              <ControlPanel
                status={status}
                settings={settings}
                onStartCamera={startCamera}
                onStopCamera={stopCamera}
                onChangeSettings={updateSettings}
                onResetSettings={resetSettings}
              />
            </div>

            <p className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
              Обработка видео выполняется полностью в браузере. Изображение с камеры никуда не передаётся.
            </p>
          </aside>
        </div>

        <IsolatedCameraTest />
      </main>
    </div>
  );
}
