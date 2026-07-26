// Called internally by trigger_ocr_check() via pg_net whenever a
// verification submission's license photo or a vehicle's ORCR document
// changes (060_ocr_document_verification.sql) -- never invoked from a
// browser, so no CORS handling needed, same as send-email/paymongo-webhook.
// Authenticated by the service_role JWT the caller already passes as the
// Authorization header (Supabase's own gateway verifies it before this code
// even runs), not a separate secret.
//
// Every result here is an admin-facing flag, never an auto-approve/reject --
// this raises the cost of casual/lazy fraud and cuts admin triage time, it
// does not catch a competent, internally-consistent forgery. On any
// internal failure the target *_ocr_findings column simply stays null
// (already its default), so admin sees "not yet checked" rather than a
// false result -- this must never surface as a hard error to the caller.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import exifr from 'npm:exifr@7.1.3';
import jpeg from 'npm:jpeg-js@0.4.4';
import { PNG } from 'npm:pngjs@7.0.0';
import jsQR from 'npm:jsqr@1.4.0';
import { Buffer } from 'node:buffer';

const GOOGLE_CLOUD_VISION_API_KEY = Deno.env.get('GOOGLE_CLOUD_VISION_API_KEY')!;

interface OcrFindings {
  name_match: 'match' | 'possible_mismatch' | 'unreadable';
  duplicate_of: string | null;
  suspicious_metadata: boolean;
  plate_match?: boolean;
  expiry_match?: boolean | null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Small inline Levenshtein distance -- not worth a dependency for this.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function matchNameInText(expectedName: string, ocrText: string): 'match' | 'possible_mismatch' | 'unreadable' {
  const blob = normalize(ocrText);
  if (blob.replace(/[^A-Z0-9]/g, '').length < 10) return 'unreadable';

  const blobTokens = blob.split(' ').filter((t) => t.length >= 2);
  const nameTokens = normalize(expectedName)
    .split(' ')
    .filter((t) => t.length >= 2); // drop single-letter middle initials etc.

  if (nameTokens.length === 0) return 'unreadable';

  const allFound = nameTokens.every((nameToken) =>
    blobTokens.some((blobToken) => {
      const maxDist = nameToken.length <= 4 ? 1 : 2;
      return levenshtein(nameToken, blobToken) <= maxDist;
    })
  );
  return allFound ? 'match' : 'possible_mismatch';
}

function matchPlateInText(plateNumber: string, ocrText: string): boolean {
  const normalizedPlate = plateNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizedBlob = ocrText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalizedPlate.length > 0 && normalizedBlob.includes(normalizedPlate);
}

// OCR date formats are unreliable across PH ORCR layouts -- returns null
// (inconclusive) whenever nothing parseable is found, rather than ever
// treating "no date found" as a mismatch.
function matchExpiryInText(expiryDate: string, ocrText: string): boolean | null {
  const target = new Date(expiryDate);
  if (Number.isNaN(target.getTime())) return null;

  const dateRegex = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g;
  const matches = [...ocrText.matchAll(dateRegex)];
  if (matches.length === 0) return null;

  for (const m of matches) {
    let candidate: Date | null = null;
    if (m[1]) {
      candidate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      let year = Number(m[6]);
      if (year < 100) year += 2000;
      candidate = new Date(year, Number(m[4]) - 1, Number(m[5]));
    }
    if (
      candidate &&
      !Number.isNaN(candidate.getTime()) &&
      candidate.getFullYear() === target.getFullYear() &&
      candidate.getMonth() === target.getMonth() &&
      candidate.getDate() === target.getDate()
    ) {
      return true;
    }
  }
  return false;
}

// Decodes a QR code from a plain image (no external calls -- purely local
// pixel decoding). Returns whatever raw text the QR encodes (for the PH
// digital driver's license this is a portal.lto.gov.ph URL, confirmed
// against a real sample), or null if no QR was found/decodable. This is
// deliberately not followed up with a server-side fetch of that URL -- see
// 061_driver_license_qr.sql for why.
function decodeQr(buffer: ArrayBuffer, mimeType: string): string | null {
  try {
    let width: number;
    let height: number;
    let data: Uint8ClampedArray;
    if (mimeType === 'image/png') {
      const png = PNG.sync.read(Buffer.from(buffer));
      width = png.width;
      height = png.height;
      data = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    } else {
      const decoded = jpeg.decode(new Uint8Array(buffer), { useTArray: true });
      width = decoded.width;
      height = decoded.height;
      data = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    }
    const result = jsQR(data, width, height);
    return result?.data ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  const { entity_type, entity_id, bucket, path, expected_name, plate_number, orcr_expiry_date, qr_path } = body ?? {};
  if (!entity_type || !entity_id || !bucket || !path) {
    return new Response(JSON.stringify({ error: 'entity_type, entity_id, bucket, path required' }), { status: 400 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucket).download(path);
    if (downloadError || !fileBlob) return new Response(JSON.stringify({ error: 'download failed' }), { status: 200 });

    const buffer = await fileBlob.arrayBuffer();

    // 1. Exact-duplicate detection (SHA-256 -- not true perceptual hashing,
    // see 060's migration comment for why).
    const hash = await sha256Hex(buffer);
    const { data: existing } = await supabase
      .from('document_hashes')
      .select('entity_id')
      .eq('hash', hash)
      .neq('entity_id', entity_id)
      .limit(1)
      .maybeSingle();
    const duplicateOf: string | null = existing?.entity_id ?? null;

    await supabase.from('document_hashes').insert({ hash, entity_type, entity_id, bucket, path });

    // 2. EXIF sniff -- weak signal, deliberately combined into one boolean.
    // "Missing camera info" is only meaningful for JPEGs -- PNG has no
    // standard camera-EXIF convention, so a genuine PNG (the upload forms
    // accept both) would otherwise false-flag almost every time.
    let suspiciousMetadata = false;
    try {
      const exif = await exifr.parse(buffer, true);
      const software = String(exif?.Software ?? '');
      const hasEditorTag = /photoshop|gimp|paint\.net|affinity/i.test(software);
      const missingCameraInfo = fileBlob.type === 'image/jpeg' && !exif?.Make && !exif?.Model;
      suspiciousMetadata = hasEditorTag || missingCameraInfo;
    } catch {
      suspiciousMetadata = false;
    }

    // 3. Google Cloud Vision OCR.
    const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_CLOUD_VISION_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: arrayBufferToBase64(buffer) }, features: [{ type: 'TEXT_DETECTION' }] }],
      }),
    });

    let ocrText = '';
    if (visionRes.ok) {
      const visionData = await visionRes.json();
      ocrText = visionData?.responses?.[0]?.textAnnotations?.[0]?.description ?? '';
    }

    const findings: OcrFindings = {
      name_match: matchNameInText(expected_name ?? '', ocrText),
      duplicate_of: duplicateOf,
      suspicious_metadata: suspiciousMetadata,
    };

    if (entity_type === 'vehicle') {
      if (plate_number) findings.plate_match = matchPlateInText(plate_number, ocrText);
      if (orcr_expiry_date) findings.expiry_match = matchExpiryInText(orcr_expiry_date, ocrText);
    }

    let qrDecodedContent: string | null = null;
    if (entity_type === 'verification' && qr_path) {
      const { data: qrBlob } = await supabase.storage.from(bucket).download(qr_path);
      if (qrBlob) {
        const qrBuffer = await qrBlob.arrayBuffer();
        qrDecodedContent = decodeQr(qrBuffer, qrBlob.type);
      }
    }

    if (entity_type === 'verification') {
      await supabase
        .from('verification_submissions')
        .update({ license_ocr_findings: findings, qr_decoded_content: qrDecodedContent })
        .eq('id', entity_id);
    } else if (entity_type === 'vehicle') {
      await supabase.from('vehicles').update({ orcr_ocr_findings: findings }).eq('id', entity_id);
    }

    return new Response(JSON.stringify({ ok: true, findings }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200 });
  }
});
