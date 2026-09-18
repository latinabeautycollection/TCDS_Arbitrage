# 6.2B Capture Failure Model

## Permission denied
Phase: `PERMISSION_DENIED`
Retryability: user-action dependent.
6.2B must not repeatedly prompt in a loop.

## Camera unavailable
Phase: `CAMERA_UNAVAILABLE`
The controller may attempt one best-camera fallback when world-facing selection cannot open a camera.

## Camera busy/unreadable
Phase: `CAMERA_ERROR`
Examples include `NotReadableError` and `AbortError`.

## Browser security failure
Phase: `CAMERA_ERROR`
No insecure-context workaround is allowed.

## Capture initialization failure
Phase: `CAPTURE_ERROR`
No warehouse fallback decision is made here.

## Capture timeout
Phase: `CAPTURE_ERROR`
The diagnostic operator may explicitly retry/resume. Timeout is capture health only, not a business failure.

## Background suspension
Not an error. Capture is disabled and camera turned off. Restoration is conditional on session ownership.

## Provider runtime failure
Remains owned by 6.2A runtime status. 6.2B does not reinterpret license/runtime failures as warehouse failures.
