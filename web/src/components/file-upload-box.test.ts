import { describe, expect, it } from 'vitest';
import { validateFile } from './file-upload-box';

const IMAGE_TYPES = ['image/jpeg', 'image/png'];

function makeFile(name: string, type: string, sizeBytes: number) {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('validateFile', () => {
  it('accepts a file of an allowed type under the size limit', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    expect(validateFile(file, IMAGE_TYPES)).toBeNull();
  });

  it('rejects a disallowed file type', () => {
    const file = makeFile('doc.pdf', 'application/pdf', 1024);
    expect(validateFile(file, IMAGE_TYPES)).toMatch(/accepted file type/);
  });

  it('rejects a file over the size limit', () => {
    const file = makeFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024);
    expect(validateFile(file, IMAGE_TYPES)).toMatch(/too large/);
  });

  it('respects a custom size limit', () => {
    const file = makeFile('small.jpg', 'image/jpeg', 2 * 1024 * 1024);
    expect(validateFile(file, IMAGE_TYPES, 1024 * 1024)).toMatch(/too large/);
  });
});
