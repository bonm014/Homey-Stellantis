import { Otp, OtpState } from './otp';
import mqtt from 'mqtt';
import axios from 'axios';
const { v4: uuidv4 } = require('uuid');


/**
 * STELLANTIS VEHICLE CONTROL - AIRCO/HVAC COMMANDS
 * 
 * Complete workflow om de airco in je Stellantis auto te besturen
 */

// ============================================================================
// STAP 1: MQTT TOKEN VERKRIJGEN MET OTP
// ============================================================================

interface MqttToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function getMqttToken(otpState: OtpState, clientId: string): Promise<MqttToken> {
  console.log('[MQTT] OTP code genereren...');
  
  // Laad OTP object uit state
  const otp = Otp.fromJSON(otpState);
  
  // Genereer OTP code (max 6x per 24 uur!)
  const otpCode = await otp.getOtpCode();
  
  if (!otpCode) {
    throw new Error('Kon geen OTP code genereren');
  }
  
  console.log('[MQTT] OTP code gegenereerd:', otpCode);
  
  // Vraag MQTT token aan met OTP code als wachtwoord
  const response = await axios.post(
    'https://mw-web-bff.mpsa.com/v1/oauth/token',
    {
      grant_type: 'password',
      password: otpCode
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-introspect-realm': 'INTROSPECT_REALM'
      },
      params: {
        client_id: clientId
      }
    }
  );
  
  console.log('[MQTT] Token verkregen, verloopt over', response.data.expires_in, 'seconden');
  
  // Sla de nieuwe OTP state op (counters zijn geüpdatet)
  const newOtpState = otp.toJSON();
  
  return {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in: response.data.expires_in
  };
}

// ============================================================================
// STAP 2: MQTT TOKEN REFRESHEN (ZONDER OTP - BESPAART RATE LIMIT!)
// ============================================================================

async function refreshMqttToken(refreshToken: string, clientId: string): Promise<MqttToken> {
  console.log('[MQTT] Token refreshen met refresh_token (geen OTP nodig)...');
  
  const response = await axios.post(
    'https://mw-web-bff.mpsa.com/v1/oauth/token',
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    },
    {
      headers: {
        'Content-Type': 'application/json'
      },
      params: {
        client_id: clientId
      }
    }
  );
  
  console.log('[MQTT] Token gerefreshed zonder OTP!');
  
  return {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in: response.data.expires_in
  };
}

// ============================================================================
// STAP 3: MQTT CLIENT SETUP
// ============================================================================

const MQTT_SERVER = 'mwa.mpsa.com';
const MQTT_PORT = 8885;
const MQTT_KEEP_ALIVE = 60;
const MQTT_QOS = 1;

interface MqttCommandOptions {
  accessToken: string;
  customerId: string;
  vin: string;
}

class StellantisVehicleControl {
  private client: mqtt.MqttClient | null = null;
  private accessToken: string;
  private customerId: string;
  private vin: string;
  private responseHandlers: Map<string, (response: any) => void> = new Map();

  constructor(options: MqttCommandOptions) {
    this.accessToken = options.accessToken;
    this.customerId = options.customerId;
    this.vin = options.vin;
  }

  // ============================================================================
  // MQTT CONNECTIE
  // ============================================================================

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[MQTT] Verbinden met Stellantis MQTT server...');
      
      this.client = mqtt.connect(`mqtts://${MQTT_SERVER}:${MQTT_PORT}`, {
        username: 'IMA_OAUTH_ACCESS_TOKEN',
        password: this.accessToken,
        protocol: 'mqtts',
        keepalive: MQTT_KEEP_ALIVE,
        clean: true,
        rejectUnauthorized: true
      });

      this.client.on('connect', () => {
        console.log('[MQTT] ✓ Verbonden met Stellantis MQTT server');
        
        // Subscribe naar response en event topics
        const topics = [
          `psa/RemoteServices/from/cid/${this.customerId}/#`,
          `psa/RemoteServices/events/MPHRTServices/${this.vin}`
        ];
        
        topics.forEach(topic => {
          this.client!.subscribe(topic, { qos: MQTT_QOS }, (err) => {
            if (err) {
              console.error('[MQTT] Subscribe error:', topic, err);
            } else {
              console.log('[MQTT] ✓ Subscribed:', topic);
            }
          });
        });
        
        resolve();
      });

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message);
      });

      this.client.on('error', (error) => {
        console.error('[MQTT] Error:', error);
        reject(error);
      });

      this.client.on('close', () => {
        console.log('[MQTT] Verbinding gesloten');
      });
    });
  }

  private handleMessage(topic: string, message: Buffer): void {
    try {
      const data = JSON.parse(message.toString());
      console.log('[MQTT] Bericht ontvangen:', topic);
      console.log('[MQTT] Data:', JSON.stringify(data, null, 2));
      
      // Check voor response op onze command
      if (data.correlation_id) {
        const handler = this.responseHandlers.get(data.correlation_id);
        if (handler) {
          handler(data);
          this.responseHandlers.delete(data.correlation_id);
        }
      }
    } catch (error) {
      console.error('[MQTT] Error parsing message:', error);
    }
  }

  // ============================================================================
  // COMMAND VERSTUREN
  // ============================================================================

  private async sendCommand(service: string, params: any): Promise<any> {
    if (!this.client || !this.client.connected) {
      throw new Error('MQTT client niet verbonden');
    }

    return new Promise((resolve, reject) => {
      const correlationId = uuidv4().replace(/-/g, '') + Date.now().toString().substring(0, 14);
      const topic = `psa/RemoteServices/to/cid/${this.customerId}${service}`;
      
      const message = JSON.stringify({
        access_token: this.accessToken,
        customer_id: this.customerId,
        correlation_id: correlationId,
        req_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        vin: this.vin,
        req_parameters: params
      });

      console.log('[MQTT] Command verzenden:');
      console.log('  Topic:', topic);
      console.log('  Correlation ID:', correlationId);
      console.log('  Parameters:', JSON.stringify(params, null, 2));

      // Timeout na 30 seconden
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(correlationId);
        reject(new Error('Command timeout - geen response ontvangen'));
      }, 30000);

      // Handler voor response
      this.responseHandlers.set(correlationId, (response) => {
        clearTimeout(timeout);
        
        if (response.return_code === '0' || response.process_code === '0') {
          console.log('[MQTT] ✓ Command succesvol uitgevoerd');
          resolve(response);
        } else {
          console.error('[MQTT] ✗ Command gefaald:', response.return_code || response.process_code);
          reject(new Error(`Command failed: ${response.return_code || response.process_code}`));
        }
      });

      // Verzend command
      this.client!.publish(topic, message, { qos: MQTT_QOS }, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.responseHandlers.delete(correlationId);
          reject(error);
        }
      });
    });
  }

  // ============================================================================
  // AIRCO/HVAC COMMANDS
  // ============================================================================

  /**
   * Start de airco/verwarming (preconditioning) - DIRECT/NU
   */
  async startAirco(temperature: number = 21): Promise<void> {
    console.log(`[HVAC] Airco starten op ${temperature}°C (direct/nu)...`);
    
    await this.sendCommand('/ThermalPrecond', {
      asap: 'true'
      // Geen programs - dit start de airco DIRECT
    });
    
    console.log('[HVAC] ✓ Airco gestart!');
  }

  /**
   * Stop de airco/verwarming
   */
  async stopAirco(): Promise<void> {
    console.log('[HVAC] Airco stoppen...');
    
    await this.sendCommand('/ThermalPrecond/disable', {});
    
    console.log('[HVAC] ✓ Airco gestopt!');
  }

  /**
   * Start het opladen (voor elektrische auto's)
   */
  async startCharging(): Promise<void> {
    console.log('[CHARGING] Opladen starten...');
    
    await this.sendCommand('/Charge', {
      charging_mode: 'slow'
    });
    
    console.log('[CHARGING] ✓ Opladen gestart!');
  }

  /**
   * Stop het opladen
   */
  async stopCharging(): Promise<void> {
    console.log('[CHARGING] Opladen stoppen...');
    
    await this.sendCommand('/Charge/disable', {});
    
    console.log('[CHARGING] ✓ Opladen gestopt!');
  }

  /**
   * Zet laadbegrenzing (bijv. 80%)
   */
  async setChargeLimit(percentage: number): Promise<void> {
    console.log(`[CHARGING] Laadbegrenzing instellen op ${percentage}%...`);
    
    await this.sendCommand('/ChargeThresholds', {
      charge_level: percentage
    });
    
    console.log('[CHARGING] ✓ Laadbegrenzing ingesteld!');
  }

  /**
   * Ontgrendel de auto
   */
  async unlockDoors(): Promise<void> {
    console.log('[DOORS] Deuren ontgrendelen...');
    
    await this.sendCommand('/Doors/unlock', {});
    
    console.log('[DOORS] ✓ Deuren ontgrendeld!');
  }

  /**
   * Vergrendel de auto
   */
  async lockDoors(): Promise<void> {
    console.log('[DOORS] Deuren vergrendelen...');
    
    await this.sendCommand('/Doors/lock', {});
    
    console.log('[DOORS] ✓ Deuren vergrendeld!');
  }

  /**
   * Toeteren (claxon)
   */
  async horn(): Promise<void> {
    console.log('[HORN] Toeteren...');
    
    await this.sendCommand('/Horn', {
      nb_horn: 3,
      interval: 1
    });
    
    console.log('[HORN] ✓ Getoeterd!');
  }

  /**
   * Lichten knipperen
   */
  async flashLights(): Promise<void> {
    console.log('[LIGHTS] Lichten knipperen...');
    
    await this.sendCommand('/Lights', {
      nb_light: 3,
      interval: 1
    });
    
    console.log('[LIGHTS] ✓ Lichten geknipperd!');
  }

  /**
   * Wake-up command (voor auto's in slaapstand)
   */
  async wakeUp(): Promise<void> {
    console.log('[WAKEUP] Auto wakker maken...');
    
    await this.sendCommand('/WakeUp', {});
    
    console.log('[WAKEUP] ✓ Auto is wakker!');
  }

  // ============================================================================
  // DISCONNECT
  // ============================================================================

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      console.log('[MQTT] ✓ Verbinding verbroken');
    }
  }
}

// ============================================================================
// COMPLETE VOORBEELD: VAN OTP STATE TOT AIRCO STARTEN
// ============================================================================

async function completeAircoExample(
  otpState: OtpState,
  clientId: string,
  customerId: string,
  vin: string
) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     STELLANTIS AIRCO CONTROL - COMPLETE WORKFLOW          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Stap 1: Verkrijg MQTT token met OTP
    console.log('STAP 1: MQTT Token verkrijgen\n');
    const mqttToken = await getMqttToken(otpState, clientId);
    
    // Stap 2: Maak vehicle control client
    console.log('\nSTAP 2: Vehicle Control initialiseren\n');
    const vehicle = new StellantisVehicleControl({
      accessToken: mqttToken.access_token,
      customerId: customerId,
      vin: vin
    });

    // Stap 3: Verbind met MQTT
    console.log('STAP 3: Verbinden met MQTT\n');
    await vehicle.connect();

    // Wacht even zodat subscriptions actief zijn
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Stap 4: Start de airco!
    console.log('\nSTAP 4: Airco starten\n');
    await vehicle.startAirco(21);

    // Wacht 5 minuten
    console.log('\nWachten 5 minuten...\n');
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));

    // Stap 5: Stop de airco
    console.log('\nSTAP 5: Airco stoppen\n');
    await vehicle.stopAirco();

    // Disconnect
    vehicle.disconnect();

    console.log('\n✓ Klaar!\n');

  } catch (error) {
    console.error('\n✗ Error:', error);
    throw error;
  }
}

// ============================================================================
// KORTERE VOORBEELDEN
// ============================================================================

/**
 * Voorbeeld 1: Alleen airco starten
 */
async function simpleAircoStart(otpState: OtpState, config: any) {
  const token = await getMqttToken(otpState, config.clientId);
  const vehicle = new StellantisVehicleControl({
    accessToken: token.access_token,
    customerId: config.customerId,
    vin: config.vin
  });
  
  await vehicle.connect();
  await new Promise(r => setTimeout(r, 2000));
  await vehicle.startAirco(21);
  
  console.log('✓ Airco gestart! Auto wordt voorverwarmd.');
  
  vehicle.disconnect();
}

/**
 * Voorbeeld 2: Deuren ontgrendelen
 */
async function unlockCar(otpState: OtpState, config: any) {
  const token = await getMqttToken(otpState, config.clientId);
  const vehicle = new StellantisVehicleControl({
    accessToken: token.access_token,
    customerId: config.customerId,
    vin: config.vin
  });
  
  await vehicle.connect();
  await new Promise(r => setTimeout(r, 2000));
  await vehicle.unlockDoors();
  
  console.log('✓ Auto ontgrendeld!');
  
  vehicle.disconnect();
}

/**
 * Voorbeeld 3: Auto vinden (toeter + licht)
 */
async function findMyCar(otpState: OtpState, config: any) {
  const token = await getMqttToken(otpState, config.clientId);
  const vehicle = new StellantisVehicleControl({
    accessToken: token.access_token,
    customerId: config.customerId,
    vin: config.vin
  });
  
  await vehicle.connect();
  await new Promise(r => setTimeout(r, 2000));
  
  // Toeter EN knipperlicht
  await vehicle.horn();
  await vehicle.flashLights();
  
  console.log('✓ Auto zou nu moeten toeteren en knipperen!');
  
  vehicle.disconnect();
}

// ============================================================================
// TOKEN MANAGER MET AUTO-REFRESH
// ============================================================================

class MqttTokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: Date | null = null;
  private clientId: string;
  private otpState: OtpState;

  constructor(otpState: OtpState, clientId: string) {
    this.otpState = otpState;
    this.clientId = clientId;
  }

  async getAccessToken(): Promise<string> {
    const now = new Date();

    // Check if token exists and is not expired
    if (this.accessToken && this.expiresAt && now < this.expiresAt) {
      return this.accessToken;
    }

    // Try to refresh if we have a refresh token
    if (this.refreshToken) {
      try {
        console.log('[TOKEN] Refreshing met refresh_token (geen OTP)...');
        const token = await refreshMqttToken(this.refreshToken, this.clientId);
        this.updateToken(token);
        return this.accessToken!;
      } catch (error) {
        console.log('[TOKEN] Refresh failed, getting new token met OTP...');
      }
    }

    // Get new token with OTP
    console.log('[TOKEN] Getting new token met OTP...');
    const token = await getMqttToken(this.otpState, this.clientId);
    this.updateToken(token);
    return this.accessToken!;
  }

  private updateToken(token: MqttToken): void {
    this.accessToken = token.access_token;
    this.refreshToken = token.refresh_token;
    this.expiresAt = new Date(Date.now() + (token.expires_in * 1000));
    console.log('[TOKEN] Token updated, expires at:', this.expiresAt);
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export {
  getMqttToken,
  refreshMqttToken,
  StellantisVehicleControl,
  MqttTokenManager,
  completeAircoExample,
  simpleAircoStart,
  unlockCar,
  findMyCar
};

export type { MqttToken, MqttCommandOptions };