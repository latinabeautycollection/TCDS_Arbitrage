export type ReceiveStage = 'SCAN_PACKAGE'|'MATCH_PACKAGE'|'INSPECT_PACKAGE'|'OPEN_SESSION'|'COUNT_CONTENTS'|'CAPTURE_ITEM'|'EMPLOYEE_SUBMIT'|'SERVER_VALIDATE'|'INTELLIGENCE_VERIFY'|'VERIFIED_FOR_INTAKE'|'REVIEW_REQUIRED'|'REJECTED'|'BARCODE_ALLOCATED'|'HANDOFF'|'RECEIPT_SUMMARY';
export type PackageCondition = 'INTACT'|'CRUSHED'|'PUNCTURED'|'WET'|'OPENED'|'RESEALED'|'TAMPERED'|'OTHER';
export interface ReceiptLine { receiptLineId: string; expectedTitle: string; expectedQuantity: number; receivedQuantity: number; status: string; requiresSerial: boolean; }
export interface ReceiptMatch { receiptId: string; receiptNumber: string; sourceSystem: string; sourceOrderId: string; carrierCode: string; trackingNumber: string; expectedItemCount: number; packageCount: number; lines: ReceiptLine[]; }
export interface ReceivingSession { receivingSessionId: string; inboundPackageId: string; stationCode: string; employeeNumber: string; itemCount: number; exceptionCount: number; status: string; }
export interface IntakeItemDraft { receiptLineId: string; expectedTitle: string; upc: string; manufacturerPartNumber: string; serialNumber: string; condition: 'NEW'|'LIKE_NEW'|'GOOD'|'FAIR'|'DAMAGED'|'UNKNOWN'; quantity: number; employeeConfirmed: boolean; }
export interface IntakeCandidate { intakeCandidateId: string; itemIndex: number; itemTotal: number; status: string; }
export interface IntakeVerificationResult { status: 'PENDING'|'PROCESSING'|'VERIFIED'|'VERIFIED_WITH_WARNING'|'REVIEW_REQUIRED'|'REJECTED'; confidence: number|null; reasons: string[]; reviewTaskId?: string; }
export interface AllocatedBarcode { barcodeId: string; itemId: string; value: string; status: 'ACTIVE_PENDING_PRINT'; printStatus: 'PENDING_REPACKAGING'; committedAt: string; }
export interface ReceiveBootstrap { station: { stationCode: string; ready: boolean; reasons: string[] }; scanner: { ready: boolean; mode: string }; network: { online: boolean }; offlineQueueCount: number; }
export interface ReceiptSummary { expectedItems: number; processedItems: number; verifiedItems: number; reviewItems: number; rejectedItems: number; blockingExceptions: number; remainingItems: number; canComplete: boolean; }
