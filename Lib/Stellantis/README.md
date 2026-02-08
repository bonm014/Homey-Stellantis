# Stellantis API - TypeScript Module

Een **TypeScript** module voor het communiceren met de Stellantis/PSA API voor verbonden voertuigen.

## ✨ Features

- 🔷 **Full TypeScript** support met type definitions
- 🚗 **Alle merken**: Peugeot, Citroën, DS, Opel, Vauxhall
- 🔐 **OAuth2 + OTP** authenticatie
- 🔄 **Auto-refresh** token management
- 📱 **SMS verificatie** ondersteuning
- ⚡ **Type-safe** API calls
- 📦 **Tree-shakeable** exports

## 📦 Installatie

```bash
npm install
npm run build
```

## 🚀 Quick Start

```typescript
import { StellantisClient, StellantisTokenManager } from './dist';

// Met Token Manager (aanbevolen)
const manager = new StellantisTokenManager({ brand: 'peugeot' });
await manager.loadTokens();
manager.startAutoRefresh();

const client = await manager.getClient();
const vehicles = await client.getVehicles();
```

## 📖 Basis Gebruik

### Client Setup

```typescript
import { StellantisClient } from './dist';

const client = new StellantisClient({
  brand: 'peugeot',  // of 'citroen', 'ds', 'opel', 'vauxhall'
  country: 'NL',
  locale: 'nl_NL'
});

// Stel token in
client.setAccessToken('your_access_token', 'your_refresh_token');
```

### OAuth2 Authenticatie

```typescript
import { StellantisOAuth } from './dist';

const oauth = new StellantisOAuth({ brand: 'peugeot' });

// Stap 1: Verkrijg authorization URL
const { authUrl } = oauth.getAuthorizationUrl();
console.log('Open:', authUrl);

// Stap 2: Gebruiker logt in en krijgt redirect URL
const redirectUrl = 'myap://oauth2redirect?code=...';
oauth.extractAuthorizationCode(redirectUrl);

// Stap 3: Wissel code in (kan OTP vereisen)
let tokens = await oauth.exchangeCodeForToken();

if ('needsOTP' in tokens && tokens.needsOTP) {
  // OTP vereist
  const otpCode = '123456'; // Van SMS
  tokens = await oauth.exchangeCodeWithOTP(tokens.authorizationCode, otpCode);
}

console.log('Access Token:', tokens.accessToken);
```

### Token Manager (Aanbevolen)

```typescript
import { StellantisTokenManager } from './dist';

const manager = new StellantisTokenManager({
  brand: 'peugeot',
  tokenFile: 'tokens.json',
  autoRefresh: true,
  refreshBeforeExpiry: 300 // 5 minuten
});

// Laad en start auto-refresh
await manager.loadTokens();
manager.startAutoRefresh();

// Verkrijg client met altijd geldige tokens
const client = await manager.getClient();

// Gebruik normaal
const vehicles = await client.getVehicles();
const status = await client.getVehicleStatus(vin);
```

## 🎯 Type Definitions

### Voertuig Types

```typescript
import type { Vehicle, VehicleStatus, BatteryInfo } from './dist';

// Vehicle
const vehicle: Vehicle = {
  vin: 'VF3XXXXXXXXXXXXXXX',
  brand: 'Peugeot',
  model: 'e-208',
  modelYear: '2023'
};

// Vehicle Status
const status: VehicleStatus = await client.getVehicleStatus(vin);

// Battery Info
const batteries: BatteryInfo[] = await client.getBatteryInfo(vin);
batteries.forEach(b => {
  console.log(`${b.type}: ${b.level}% (${b.autonomy} km)`);
});
```

### Token Types

```typescript
import type { 
  AuthTokens, 
  OAuthTokens, 
  TokenStatus,
  TokenManagerStatus 
} from './dist';

// Auth Tokens
const tokens: AuthTokens = {
  accessToken: 'eyJ...',
  refreshToken: 'eyJ...',
  expiresIn: 3600
};

// Token Status
const status: TokenStatus = oauth.getTokenStatus();
console.log('Verloopt over:', status.expiresInSeconds, 'seconden');

// Manager Status
const managerStatus: TokenManagerStatus = manager.getStatus();
console.log('Verloopt over:', managerStatus.expiresInMinutes, 'minuten');
```

### Brand Types

```typescript
import type { BrandType, ClientOptions } from './dist';

// Brand Type
const brand: BrandType = 'peugeot'; // Type-safe!

// Client Options
const options: ClientOptions = {
  brand: 'citroen',
  country: 'NL',
  locale: 'nl_NL'
};
```

## 📚 API Methodes

### Voertuig Informatie

```typescript
// Alle voertuigen
const vehicles: VehiclesResponse = await client.getVehicles();

// Voertuig status
const status: VehicleStatus = await client.getVehicleStatus(vin);

// Batterij info
const batteries: BatteryInfo[] = await client.getBatteryInfo(vin);

// Laadstatus (EV)
const charging: ChargingStatus | null = await client.getChargingStatus(vin);

// Kilometerstand
const odometer: OdometerInfo = await client.getOdometer(vin);

// Positie
const position: Position = await client.getVehiclePosition(vin);

// Alerts
const alerts: Alert[] = await client.getVehicleAlerts(vin);

// Onderhoud
const maintenance: Maintenance = await client.getVehicleMaintenance(vin);
```

### Voertuig Besturing

```typescript
// Wake up
await client.wakeupVehicle(vin);

// Deuren
await client.setDoorLock(vin, true);  // vergrendelen
await client.setDoorLock(vin, false); // ontgrendelen

// Voorverwarming
await client.setPreconditioning(vin, true);  // starten
await client.setPreconditioning(vin, false); // stoppen

// Laden (EV)
await client.setCharging(vin, true);  // start
await client.setCharging(vin, false); // stop
await client.setChargeLimit(vin, 80); // limiet 80%

// Toeter & lichten
await client.activateHornAndLights(vin);
```

## 🔄 Token Refresh

### Automatisch

```typescript
const manager = new StellantisTokenManager({ brand: 'peugeot' });
await manager.loadTokens();

// Start auto-refresh (checkt elke 60 seconden)
manager.startAutoRefresh();

// Gebruik de API - tokens blijven geldig
const client = await manager.getClient();
```

### Handmatig

```typescript
// Check of refresh nodig is
if (manager.needsRefresh()) {
  await manager.refresh();
}

// Of: zorg altijd voor geldige token
await manager.ensureValidToken();
```

### Status Monitoring

```typescript
// Print status
manager.printStatus();

// Verkrijg status data
const status: TokenManagerStatus = manager.getStatus();
console.log('Verloopt over:', status.expiresInMinutes, 'minuten');
console.log('Auto-refresh:', status.autoRefreshActive);
```

## 🏗️ Project Structuur

```
stellantis-api-ts/
├── src/
│   ├── index.ts           # Main exports
│   ├── types.ts           # Type definitions
│   ├── client.ts          # StellantisClient
│   ├── oauth.ts           # StellantisOAuth
│   └── token-manager.ts   # StellantisTokenManager
├── dist/                  # Compiled JavaScript + .d.ts
├── package.json
└── tsconfig.json
```

## 🔨 Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Clean
npm run clean
```

## 📝 Type-Safe Voorbeelden

### Async/Await met Types

```typescript
async function getVehicleInfo(vin: string): Promise<void> {
  const manager = new StellantisTokenManager({ brand: 'peugeot' });
  await manager.loadTokens();
  
  const client = await manager.getClient();
  
  // Type-safe calls
  const status: VehicleStatus = await client.getVehicleStatus(vin);
  const batteries: BatteryInfo[] = await client.getBatteryInfo(vin);
  
  batteries.forEach((battery: BatteryInfo) => {
    console.log(`${battery.type}: ${battery.level}%`);
  });
}
```

### Type Guards

```typescript
import type { AuthTokens, OTPRequiredResult } from './dist';

async function authenticate(): Promise<AuthTokens> {
  const oauth = new StellantisOAuth({ brand: 'peugeot' });
  const { authUrl } = oauth.getAuthorizationUrl();
  
  // ... gebruiker logt in ...
  
  const result = await oauth.exchangeCodeForToken(code);
  
  // Type guard
  if ('needsOTP' in result) {
    // result is OTPRequiredResult
    const otpCode = await getOTPFromUser();
    return await oauth.exchangeCodeWithOTP(result.authorizationCode, otpCode);
  }
  
  // result is AuthTokens
  return result;
}
```

### Generic Helper

```typescript
async function withAutoRefresh<T>(
  callback: (client: StellantisClient) => Promise<T>
): Promise<T> {
  const manager = new StellantisTokenManager({ brand: 'peugeot' });
  await manager.loadTokens();
  manager.startAutoRefresh();
  
  try {
    const client = await manager.getClient();
    return await callback(client);
  } finally {
    manager.destroy();
  }
}

// Gebruik
const vehicles = await withAutoRefresh(async (client) => {
  return await client.getVehicles();
});
```

## ⚙️ TypeScript Config

De module gebruikt strikte TypeScript instellingen:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## 📦 Import Opties

```typescript
// Named imports (aanbevolen)
import { StellantisClient, StellantisTokenManager } from './dist';

// Default import
import StellantisClient from './dist';

// Type-only imports
import type { Vehicle, BatteryInfo } from './dist';

// Alles
import * as Stellantis from './dist';
```

## 🔍 Nuttige Types

```typescript
// Check alle beschikbare types
import type {
  // Client
  BrandType,
  ClientOptions,
  BrandConfig,
  
  // Auth
  AuthTokens,
  OAuthTokens,
  TokenStatus,
  
  // Vehicles
  Vehicle,
  VehicleStatus,
  VehiclesResponse,
  
  // Battery & Charging
  BatteryInfo,
  ChargingStatus,
  EnergyInfo,
  
  // Other
  Position,
  Alert,
  Maintenance,
  OdometerInfo
} from './dist';
```

## 📖 Documentatie

- **JavaScript versie**: Zie `../stellantis-api/README.md`
- **OTP Guide**: Zie `../stellantis-api/OTP-GUIDE.md`
- **Token Refresh**: Zie `../stellantis-api/TOKEN-REFRESH.md`

## 🆚 JavaScript vs TypeScript

| Feature | JavaScript | TypeScript |
|---------|-----------|------------|
| Type Safety | ❌ | ✅ |
| Autocomplete | ⚠️ Limited | ✅ Full |
| Compile Check | ❌ | ✅ |
| Runtime | ✅ Direct | ⚠️ Build step |
| File Size | ✅ Smaller | ⚠️ Larger |

## 📄 Licentie

MIT

## 🙏 Credits

Gebaseerd op:
- [Home Assistant Stellantis Integration](https://github.com/andreadegiovine/homeassistant-stellantis-vehicles)
- [PSA Car Controller](https://github.com/flobz/psa_car_controller)
