export class PhotoCleanupCancelledError extends Error {
  constructor() {
    super('Photo cleanup cancelled');
    this.name = 'PhotoCleanupCancelledError';
    this.code = 'PHOTO_CLEANUP_CANCELLED';
  }
}

let cancelRequested = false;

export function beginPhotoCleanup() {
  cancelRequested = false;
}

export function requestPhotoCleanupCancel() {
  cancelRequested = true;
}

export function isPhotoCleanupCancelled() {
  return cancelRequested;
}

export function throwIfPhotoCleanupCancelled() {
  if (cancelRequested) throw new PhotoCleanupCancelledError();
}

export function clearPhotoCleanupCancel() {
  cancelRequested = false;
}

export function isPhotoCleanupCancelledError(err) {
  return err?.code === 'PHOTO_CLEANUP_CANCELLED' || err?.name === 'PhotoCleanupCancelledError';
}
