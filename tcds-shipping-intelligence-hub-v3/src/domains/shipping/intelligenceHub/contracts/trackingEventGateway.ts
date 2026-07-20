export interface NormalizedTrackingEvent {
  shipmentId: number;
  carrierCode: string;
  trackingNumber?: string;
  eventCode?: string;
  eventDescription?: string;
  eventLocation?: string;
  eventTime: Date;
  delivered: boolean;
  exception: boolean;
  raw?: Record<string, unknown>;
}

export interface TrackingEventGateway {
  getEvents(shipmentId: number): Promise<NormalizedTrackingEvent[]>;
}
