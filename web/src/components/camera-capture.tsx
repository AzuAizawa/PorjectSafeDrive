import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface CameraCaptureProps {
  label: string;
  onCapture: (file: File, motionDetected: boolean) => void;
  captured: File | null;
}

// Forces a live camera photo rather than a file picker — the actual fraud
// vector for a selfie is someone uploading an old or stolen photo of
// themselves, which a file input can't prevent but a live capture can.
export function CameraCapture({ label, onCapture, captured }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Soft anti-replay signal, not real biometric liveness detection (that's
  // a paid-SDK problem): samples downscaled frames while the camera is live
  // and flags whether *any* natural frame-to-frame motion was seen. A
  // printed photo or a phone/screen held dead-still in front of the camera
  // shows ~zero pixel variance; a real face never holds perfectly still.
  // Deliberately never blocks Capture — just tags the resulting file so
  // admin can see a low-motion warning, since lighting/stillness can cause
  // false positives.
  const motionDetectedRef = useRef(false);
  const lastFrameRef = useRef<Uint8ClampedArray | null>(null);
  const motionIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The <video> element only mounts once `active` is true (it doesn't exist
  // yet while getUserMedia() is being awaited), so assigning srcObject
  // straight after the stream resolves was landing on a still-null ref —
  // that's why there was no preview and Capture produced a blank frame.
  // Doing the assignment in an effect keyed on `active` guarantees the
  // video element exists by the time we attach the stream to it.
  useEffect(() => {
    if (active && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      startMotionSampling();
    }
    return () => stopMotionSampling();
  }, [active]);

  function startMotionSampling() {
    motionDetectedRef.current = false;
    lastFrameRef.current = null;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 32;
    sampleCanvas.height = 32;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    motionIntervalRef.current = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !ctx || video.videoWidth === 0) return;
      ctx.drawImage(video, 0, 0, 32, 32);
      const frame = ctx.getImageData(0, 0, 32, 32).data;
      if (lastFrameRef.current) {
        let diff = 0;
        for (let i = 0; i < frame.length; i += 4) diff += Math.abs(frame[i] - lastFrameRef.current[i]);
        if (diff / (frame.length / 4) > 3) motionDetectedRef.current = true;
      }
      lastFrameRef.current = frame;
    }, 150);
  }

  function stopMotionSampling() {
    if (motionIntervalRef.current !== null) {
      window.clearInterval(motionIntervalRef.current);
      motionIntervalRef.current = null;
    }
  }

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setActive(true);
    } catch {
      setError('Could not access your camera. Check your browser permissions and try again.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopMotionSampling();
    setActive(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError('Camera is still starting up — give it a second and try Capture again.');
      return;
    }
    setError(null);
    const motionDetected = motionDetectedRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `${label.toLowerCase().replace(/\s+/g, '-')}.jpg`, { type: 'image/jpeg' });
        setPreviewUrl(URL.createObjectURL(blob));
        onCapture(file, motionDetected);
        stopCamera();
      },
      'image/jpeg',
      0.9
    );
  }

  function retake() {
    setPreviewUrl(null);
    startCamera();
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <div className="overflow-hidden rounded-xl border-2 border-dashed border-line bg-surface-2/70 backdrop-blur-sm">
        {captured && previewUrl ? (
          <div className="relative">
            <img src={previewUrl} alt={label} className="aspect-video w-full object-cover" />
            <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-2" onClick={retake}>
              Retake
            </Button>
          </div>
        ) : active ? (
          <div className="relative">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full scale-x-[-1] object-cover" />
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bad" /> LIVE
            </span>
            <Button type="button" size="sm" className="absolute bottom-2 left-1/2 -translate-x-1/2" onClick={capture}>
              📸 Capture
            </Button>
            <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-2" onClick={stopCamera}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="flex aspect-video w-full flex-col items-center justify-center gap-1 text-xs font-semibold text-muted hover:text-accent"
            onClick={startCamera}
          >
            📷 Click to open camera
          </button>
        )}
      </div>
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : null}
    </div>
  );
}
