export type MessageSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type MessagePresentation = 'INLINE' | 'BANNER' | 'TOAST' | 'SHEET';

export type PackShipMessage = {
  code: string;
  severity: MessageSeverity;
  presentation: MessagePresentation;
  blocking: boolean;
  retryable: boolean;
  title: string;
  explanation: string;
  nextAction: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  supportReference?: string;
  field?: 'scan' | 'weight' | 'length' | 'width' | 'height' | 'address' | 'rate' | 'label' | 'tracking' | 'package' | 'outbound';
  stage?: 'CONTENTS' | 'PACKAGING' | 'MEASUREMENTS' | 'EVIDENCE' | 'ADDRESS' | 'RATES' | 'LABEL' | 'OUTBOUND';
  steps?: string[];
  announce?: string;
};
