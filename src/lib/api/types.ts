// PO Mapping Engine

export interface ManipulatorEntry {
  type: string;
  params: string[];
}

export interface FieldMappingEntry {
  externalField?: string;
  fixedValue?: string;
  fieldManipulators?: ManipulatorEntry[];
}

export interface PoMappingConfig {
  hasHeaderRecord: boolean;
  separator: string;
  header: Record<string, FieldMappingEntry>;
  lines: Record<string, FieldMappingEntry>;
}

export interface MappedOrderLine {
  lineNumber?: string;
  buyerItemCode?: string;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
}

export interface MappedOrder {
  poNumber?: string;
  orderDate?: string;
  buyerName?: string;
  currency?: string;
  lines: MappedOrderLine[];
}

export interface TestPoMappingRequest {
  headerRow: Record<string, string>;
  lineRows: Record<string, string>[];
  config: PoMappingConfig;
}

// Supplier delivery configuration

export type DeliveryProtocol = "http" | "sftp" | "ftp";

export interface DeliveryConfig {
  supplierId: string;
  protocol: DeliveryProtocol;
  autoDeliver: boolean;
  configJson: string;
  hasCredentials: boolean;
  credentialsDisplay?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDeliveryConfigRequest {
  protocol: DeliveryProtocol;
  autoDeliver: boolean;
  configJson: string;
  credentialsJson?: string | null;
}

export interface DeliveryTestResult {
  success: boolean;
  errorMessage?: string | null;
  responseCode?: number | null;
}
