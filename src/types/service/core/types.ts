/**
 * Core Service Types
 */

export interface BaseServiceParams {
  entity_id?: string | string[];
  area_id?: string | string[];
  device_id?: string | string[];
}

export interface ServiceCallRequest {
  domain: string;
  service: string;
  target?: BaseServiceParams;
  service_data?: Record<string, unknown>;
}

export interface ServiceCallResponse {
  success: boolean;
  result?: unknown;
}

export interface ServiceDefinition {
  name: string;
  description?: string;
  target?: {
    entity?: {
      domain: string[];
    };
    device?: {
      integration: string[];
    };
  };
  fields?: Record<string, {
    name: string;
    description?: string;
    required?: boolean;
    example?: unknown;
    selector?: Record<string, unknown>;
  }>;
}

export interface ServiceDomain {
  domain: string;
  services: Record<string, ServiceDefinition>;
}

export interface ServiceListResponse {
  success: boolean;
  domains: ServiceDomain[];
}

export interface TemplateRenderRequest {
  template: string;
  variables?: Record<string, unknown>;
}

export interface TemplateRenderResponse {
  success: boolean;
  result: string;
}

export interface ConfigCheckResponse {
  success: boolean;
  result: {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  };
}

export interface IntentHandleRequest {
  name: string;
  data?: Record<string, unknown>;
}

export interface IntentHandleResponse {
  success: boolean;
  response: {
    speech: {
      plain: {
        speech: string;
        extra_data?: unknown;
      };
    };
  };
}
