import { describe, expect, it, vi } from 'vitest';
import type { DataCaptureContext } from '@scandit/web-datacapture-core';
import { observeScanditContextStatus } from '../../src/lib/scanning/providers/scandit/scanditContextObserver';

describe('observeScanditContextStatus', () => {
  it('registers, maps, and unregisters a DataCaptureContextListener', () => {
    let listener: any;
    const context = {
      addListener(value: any) { listener = value; },
      removeListener: vi.fn(),
    } as unknown as DataCaptureContext;

    const observed = vi.fn();
    const unsubscribe = observeScanditContextStatus(context, observed);

    listener.didChangeStatus(context, { code: 13, isValid: false, message: 'expired' });
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0][0].errorCode).toBe('LICENSE_EXPIRED');

    unsubscribe();
    expect(context.removeListener).toHaveBeenCalledWith(listener);
  });
});
