import type { ContextStatus } from '@scandit/web-datacapture-core';
import type { ScannerProviderErrorCode } from '../../contracts/ScannerProviderError';
import type { ScannerRuntimePhase, ScannerRuntimeBlockingReason } from '../../contracts/ScannerRuntimeStatus';

export interface ScanditContextStatusAssessment {
  code: number;
  isValid: boolean;
  category:
    | 'SUCCESS'
    | 'UNKNOWN'
    | 'NETWORK'
    | 'LICENSE'
    | 'RESOURCE'
    | 'APPLICATION'
    | 'CAMERA'
    | 'SUBSCRIPTION'
    | 'INTERNAL'
    | 'UNKNOWN_ERROR';
  phase: ScannerRuntimePhase;
  blockingReason: ScannerRuntimeBlockingReason;
  errorCode?: ScannerProviderErrorCode;
  retryable: boolean;
  sanitizedMessage: string;
}

const LICENSE_VALIDATION_CODES = new Set([9, 10, 11]);
const LICENSE_CONFIGURATION_CODES = new Set([
  12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 29,
  1026, 1040, 1056, 1088, 1152, 1280, 1536, 2048, 3072, 5120, 9216, 33793,
]);

function safeMessage(status: ContextStatus): string {
  const text = status.message?.trim();
  if (!text) return '';
  // ContextStatus messages should never contain the configured license key,
  // but sanitize obvious credential-like shapes defensively before propagation.
  return text
    .replace(/license\s*key\s*[:=]\s*\S+/gi, 'license key=[REDACTED]')
    .slice(0, 1000);
}

export function assessScanditContextStatus(status: ContextStatus): ScanditContextStatusAssessment {
  const code = status.code;
  const sanitizedMessage = safeMessage(status);

  // A recognised failure code is authoritative even when the SDK reports the
  // context as valid, so a camera or runtime error is never published as READY.
  // Only an unrecognised code falls back to the reported validity.
  const failure = classifyScanditFailureCode(code, sanitizedMessage);
  if (failure) return failure;

  if (status.isValid || code === 1) {
    return {
      code,
      isValid: true,
      category: 'SUCCESS',
      phase: 'READY',
      blockingReason: 'NONE',
      retryable: false,
      sanitizedMessage,
    };
  }

  if (code === 0) {
    return {
      code,
      isValid: false,
      category: 'UNKNOWN',
      phase: 'INITIALIZING',
      blockingReason: 'NONE',
      retryable: true,
      sanitizedMessage,
    };
  }

  return {
    code,
    isValid: false,
    category: 'UNKNOWN_ERROR',
    phase: 'FAILED',
    blockingReason: 'SDK_CONTEXT_INVALID',
    errorCode: 'SDK_RUNTIME_FAILURE',
    retryable: false,
    sanitizedMessage,
  };
}

/** Returns null when the code is not a recognised Scandit failure code. */
function classifyScanditFailureCode(
  code: number,
  sanitizedMessage: string,
): ScanditContextStatusAssessment | null {
  if (code === 6) {
    return {
      code,
      isValid: false,
      category: 'NETWORK',
      phase: 'BLOCKED',
      blockingReason: 'SDK_CONTEXT_INVALID',
      errorCode: 'NETWORK_REQUIRED',
      retryable: true,
      sanitizedMessage,
    };
  }

  if (LICENSE_VALIDATION_CODES.has(code)) {
    return {
      code,
      isValid: false,
      category: 'LICENSE',
      phase: 'BLOCKED',
      blockingReason: 'LICENSE_REJECTED',
      errorCode: 'LICENSE_VALIDATION_FAILED',
      retryable: false,
      sanitizedMessage,
    };
  }

  if (LICENSE_CONFIGURATION_CODES.has(code)) {
    let errorCode: ScannerProviderErrorCode = 'LICENSE_REJECTED';
    if (code === 12) errorCode = 'LICENSE_CONFIGURATION_MISSING';
    else if (code === 13) errorCode = 'LICENSE_EXPIRED';
    else if (code === 14) errorCode = 'LICENSE_PLATFORM_INVALID';
    else if (code === 15) errorCode = 'LICENSE_APP_ID_INVALID';
    else if (code === 16) errorCode = 'LICENSE_DEVICE_INVALID';
    else if (code === 17 || code === 26) errorCode = 'LICENSE_SDK_VERSION_INVALID';
    else if (code === 19) errorCode = 'DEVICE_ACTIVATION_FAILED';
    else if (code === 21) errorCode = 'SCAN_LIMIT_EXCEEDED';
    else if (code === 22) errorCode = 'REGISTRATION_REQUIRED';
    else if ([24, 25, 27, 29, 1026, 1040, 1088, 1152, 1280, 1536, 2048, 3072, 5120, 9216, 33793].includes(code)) {
      errorCode = 'UNLICENSED_FEATURE';
    }

    return {
      code,
      isValid: false,
      category: 'LICENSE',
      phase: 'BLOCKED',
      blockingReason: 'LICENSE_REJECTED',
      errorCode,
      retryable: code === 19,
      sanitizedMessage,
    };
  }

  if (code === 19) {
    return {
      code,
      isValid: false,
      category: 'LICENSE',
      phase: 'BLOCKED',
      blockingReason: 'LICENSE_REJECTED',
      errorCode: 'DEVICE_ACTIVATION_FAILED',
      retryable: true,
      sanitizedMessage,
    };
  }

  if (code === 28) {
    return {
      code,
      isValid: false,
      category: 'RESOURCE',
      phase: 'FAILED',
      blockingReason: 'RUNTIME_ASSETS_UNAVAILABLE',
      errorCode: 'MISSING_RESOURCE',
      retryable: true,
      sanitizedMessage,
    };
  }

  if (code === 1025) {
    return {
      code,
      isValid: false,
      category: 'APPLICATION',
      phase: 'FAILED',
      blockingReason: 'SDK_CONTEXT_INVALID',
      errorCode: 'DISPOSED_CONTEXT',
      retryable: false,
      sanitizedMessage,
    };
  }

  if (code === 1028) {
    return {
      code,
      isValid: false,
      category: 'APPLICATION',
      phase: 'FAILED',
      blockingReason: 'SDK_CONTEXT_INVALID',
      errorCode: 'CONFLICTING_REQUIREMENTS',
      retryable: false,
      sanitizedMessage,
    };
  }

  if (code === 1032) {
    return {
      code,
      isValid: false,
      category: 'CAMERA',
      phase: 'BLOCKED',
      blockingReason: 'SDK_CONTEXT_INVALID',
      errorCode: 'CAMERA_AUTHORIZATION_REQUIRED',
      retryable: true,
      sanitizedMessage,
    };
  }

  if (code === 33794) {
    return {
      code,
      isValid: false,
      category: 'CAMERA',
      phase: 'FAILED',
      blockingReason: 'SDK_CONTEXT_INVALID',
      errorCode: 'CAMERA_RUNTIME_ERROR',
      retryable: true,
      sanitizedMessage,
    };
  }

  if ((code >= 131074 && code <= 131680)) {
    return {
      code,
      isValid: false,
      category: 'SUBSCRIPTION',
      phase: 'BLOCKED',
      blockingReason: 'LICENSE_REJECTED',
      errorCode: 'SUBSCRIPTION_ERROR',
      retryable: code < 131671,
      sanitizedMessage,
    };
  }

  if (code === 2 || code === 5) {
    return {
      code,
      isValid: false,
      category: 'INTERNAL',
      phase: 'FAILED',
      blockingReason: 'SDK_CONTEXT_INVALID',
      errorCode: 'SDK_INTERNAL_ERROR',
      retryable: code === 2,
      sanitizedMessage,
    };
  }

  return null;
}
