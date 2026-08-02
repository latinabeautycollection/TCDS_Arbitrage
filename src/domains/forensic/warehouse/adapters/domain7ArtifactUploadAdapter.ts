import { requireWarehousePrincipalContext, type ForensicPrincipal } from '../../auth/forensicPrincipal';

export interface Domain7A2UploadService {
  issueUpload(input: {
    chainId: string;
    captureSessionId?: string;
    stageCode: string;
    evidenceType: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    idempotencyKey: string;
    actorType: ForensicPrincipal['actorType'];
    actorId: string;
    metadata: Record<string, unknown>;
  }): Promise<{ artifactId: string; uploadUrl: string; expiresAt: string }>;
}

export class Domain7ArtifactUploadAdapter {
  constructor(private readonly uploadService: Domain7A2UploadService) {}

  issue(principal: ForensicPrincipal, input: {
    chainId: string;
    stageCode: string;
    evidenceType: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }) {
    const warehouse = requireWarehousePrincipalContext(principal);
    return this.uploadService.issueUpload({
      ...input,
      actorType: principal.actorType,
      actorId: principal.actorId,
      metadata: {
        ...input.metadata,
        warehouseUserId: warehouse.warehouseUserId,
        warehouseEmployeeId: warehouse.warehouseEmployeeId,
        warehouseDeviceId: warehouse.deviceId,
        warehouseStationId: warehouse.stationId,
      },
    });
  }
}
