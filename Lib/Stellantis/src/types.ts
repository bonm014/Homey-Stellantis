/**
 * Stellantis API Types
 */

export type BrandType = 'peugeot' | 'citroen' | 'ds' | 'opel' | 'vauxhall';

export interface BrandConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  realm: string;
  hostBrandCode: string;
}

export interface ClientOptions {
  brand?: BrandType;
  country?: string;
  locale?: string;
}

export interface AuthTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number;
  tokenType?: string;
  scope?: string;
}

export interface OAuthTokens extends AuthTokens {
  tokenExpiry?: number;
  brand?: BrandType;
  createdAt?: number;
}

export interface AuthorizationUrlResult {
  authUrl: string;
  state: string;
  instructions: string[];
}

export interface AuthorizationCodeResult {
  code: string;
  state: string;
  success: boolean;
}

export interface OTPRequiredResult {
  needsOTP: true;
  message: string;
  authorizationCode: string;
}

export interface TokenStatus {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt: Date | null;
  isExpired: boolean;
  expiresInSeconds: number;
}

export interface TokenManagerStatus extends TokenStatus {
  hasValidToken: boolean;
  expiresInMinutes: number;
  expiresInHours: number;
  needsRefresh: boolean;
  lastRefresh: Date | null;
  autoRefreshActive: boolean;
  canRefresh: boolean;
}

export interface TokenManagerOptions extends ClientOptions {
  tokenFile?: string;
  autoRefresh?: boolean;
  refreshBeforeExpiry?: number;
}

// Vehicle Types
export interface TripDetail {
    id: string;
    startedAt: Date;
    stoppedAt: Date;
    duration: number;
    distance: number;
    createdAt: Date;
    updatedAt: Date;
    startPosition: {
      geometry?: { type: string; coordinates: [number,number] };
      properties: { heading: number; type: string }
    };
    //startPosition: any;//{ type: 'Feature', geometry: [Object], properties: [Object] },
    done: boolean;
    startEnergies: [
      {
        type: string;
        subType: string;
        level: number;
        autonomy: number;
      }
    ];
    endEnergies: [
      {
        type: string;
        subType: string;
        level: number;
        autonomy: number;
      }
    ];
    energyConsumptions: [
      {
        consumption: number;
        avgConsumption: number;
        type: string;
        subType: string;
      }
    ];
    kinetic: { avgSpeed: number; maxSpeed: number };
    startMileage: number;
    stopPosition: {
      geometry?: { type: string; coordinates: [number,number] };
      properties: { heading: number; type: string }
    };
  }

export interface Trips {
    total: number;
    _embedded: {trips: TripDetail[]};
}

export interface Vehicle {
    id: string;
    vin: string;
    brand: string;
    motorization: string;
    pictures: string[];
}

export interface VehiclesResponse {
  embedded?: {
    vehicles: Vehicle[];
  };
}

export interface EnergyInfo {
  type: 'Electric' | 'Fuel';
  level: number;
  autonomy: number;
  updatedAt: string;
  charging?: ChargingInfo;
}

export interface ChargingInfo {
  status?: 'InProgress' | 'Disconnected' | 'Stopped';
  plugged?: boolean;
  chargingRate?: number;
  chargingMode?: string;
  nextDelayedTime?: string;
  remainingTime?: number;
}

export interface BatteryInfo {
  type: string;
  level: number;
  autonomy: number;
  updatedAt: string;
}

export interface ChargingStatus {
  charging: boolean;
  plugged?: boolean;
  chargingRate?: number;
  chargingMode?: string;
  level: number;
  autonomy: number;
  updatedAt: string;
}

export interface OdometerInfo {
  mileage: number;
  unit: string;
  updatedAt: string;
}

export interface VehicleStatus {
  energy?: EnergyInfo[];
  odometer?: {
    mileage: number;
    unit: string;
    updatedAt: string;
  };
  preconditionning?: {
    airConditioning?: {
      status?: string;
    };
  };
  updatedAt: string;
  ignition?: {
    createdAt:string;
    type:string;
  }
  battery?: {
      voltage:number;
      createdAt:string;
  }
  service?: {
    createdAt:string;
    type:string;
  }
}

export interface Position {
  type: string;
  geometry?: {
    type: string;
    coordinates: [number, number];
  };
  properties?: {
    updatedAt: string;
    heading?: number;
  };
}

export interface Alert {
  id: string;
  type: string;
  createdAt: string;
  active: boolean;
}

export interface Maintenance {
  mileageBeforeMaintenance: number;
  daysBeforeMaintenance: number;
}


export interface TelemetryData {
  updatedAt: string;
  [key: string]: any;
}

// Control Types
export interface DoorLockRequest {
  action: 'lock' | 'unlock';
}

export interface PreconditioningRequest {
  action: 'start' | 'stop';
  programs?: PreconditioningProgram[];
}

export interface PreconditioningProgram {
  slot: number;
  enabled: boolean;
  hour: number;
  minute: number;
  recurrence?: string;
}

export interface ChargingRequest {
  action: 'start' | 'stop' | 'set_limit';
  percentage?: number;
}

export interface HornLightsRequest {
  action: 'activate';
}

// API Response wrapper
export interface APIResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
}
