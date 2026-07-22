import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface CameraCaptureProps {
  label: string;
  onCapture: (file: File) => void;
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

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setActive(true);
    } catch {
      setError('Could not access your camera. Check your browser permissions and try again.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
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
        onCapture(file);
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
      <div className="overflow-hidden rounded-md border-2 border-dashed border-line bg-surface-2">
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
            <Button type="button" size="sm" className="absolute bottom-2 left-1/2 -translate-x-1/2" onClick={capture}>
              📸 Capture
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="flex aspect-video w-full flex-col items-center justify-center gap-1 text-xs font-semibold text-muted"
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
