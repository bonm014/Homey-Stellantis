import * as crypto from 'crypto';
import * as mqtt from 'mqtt';
import axios, { AxiosRequestConfig } from 'axios';
import { Otp, ConfigException } from './otp'
import type { OtpState } from './otp'

/**
 * Stellantis MQTT Remote Control Client
 * Based on Home Assistant integration
 */

// MQTT Constants (from Home Assistant const.py)
const MQTT_SERVER = 'mwa.mpsa.com';
const MQTT_PORT = 8885;
const MQTT_KEEP_ALIVE = 120;
const MQTT_QOS = 0;

// MQTT Topics
const MQTT_RESP_TOPIC = 'psa/RemoteServices/to/cid/';
const MQTT_EVENT_TOPIC = 'psa/RemoteServices/events/MPHRTServices/';
const MQTT_REQ_TOPIC = 'psa/RemoteServices/from/cid/';

interface MqttConnectResult {
  success: boolean;
  client?: mqtt.MqttClient;
  error?: string;
}

interface RemoteCommandResult {
  success: boolean;
  correlationId?: string;
  response?: any;
  error?: string;
}


/**
 * MQTT TOKEN RESULT
 */
interface MqttTokenResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  otpCode?: string;
  error?: string;
  requiresSetup?: boolean;
  otpState?: OtpState;  // Nieuwe state om in sessie op te slaan
  mqttClient?: mqtt.MqttClient
}

/**
 * OPTIONS
 */
interface OtpOptions {
  otpState?: OtpState;     // Bestaande state uit sessie
  smsCode?: string;        // Voor eerste keer setup
  pinCode?: string;        // Voor eerste keer setup
  clientId: string;
  baseUrl?: string;
}

/**
 * Configuration for Stellantis Remote Client
 */
export interface StellantisConfig {
  realm: string;
  clientId: string;
  clientSecret: string;
  countryCode: string;
  customerId: string;
  accessToken: string;
}

/**
 * Remote credentials returned after OTP validation
 */
export interface RemoteCredentials {
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
}

/**
 * Command payload for remote commands
 */
export interface CommandPayload {
  vin: string;
  action?: string;
  percentage?: number;
  temperature?: number;
  [key: string]: any;
}

/**
 * OTP Response from API
 */
interface OTPResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  err?: string;
  newversion?: string | null;
  newversionurl?: string | null;
}

/**
 * Stellantis Remote Control Client - OTP Authentication
 * Based on PSA Car Controller implementation
 * Handles OTP flow for remote commands (charging, climate control, etc.)
 */
export class StellantisRemoteClient {
  private config: StellantisConfig;
  private remoteCredentials: RemoteCredentials;
  private mqttClient: mqtt.MqttClient | null;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(config: StellantisConfig) {
    this.config = config;
    this.remoteCredentials = {
      refreshToken: null,
      accessToken: null,
      expiresAt: null
    };
    this.mqttClient = null;
  }

  getAPIHost() {
    return 'api.groupe-psa.com';
  }
  
  /**
   * Step 1: Request OTP SMS
   * This triggers an SMS to be sent to the phone number associated with the account
   */
  async requestOTP(): Promise<void> {
    
    const apiHost = this.getAPIHost();
    const url = `https://${apiHost}/applications/cvs/v4/mobile/smsCode`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId
    });
    
    try {
      console.log('\n========================================');
      console.log('STEP 1: Requesting OTP SMS');
      console.log('========================================');
      console.log('URL:', `${url}?${params.toString()}`);
      
      const response = await axios({
        method: 'POST',
        url: `${url}?${params.toString()}`,
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {},
        timeout: 30000
      });
      
      console.log('✓ SMS requested (status 202)');
      //console.log('Response:', response);
      console.log('========================================\n');
      
      return response.data;
      
    } catch (error) {
      console.error('✗ Failed to request SMS');
      console.log(error);
      if (axios.isAxiosError(error) && error.response) {
        console.error('Status:', error.response.status);
        console.error('Error:', error.response.data);
      }
      
      throw error;
    }
  }

  /**
   * Step 2: Validate OTP Code with PIN
   * @param smsCode - 4-digit code received via SMS
   * @param pin - 4-digit PIN from mobile app
   */
  async validateOTP(
    homey: any, 
    smsCode: string | null, 
    pinCode: string | null, 
    brandName: string, 
    clientId: string,
    forceReset:boolean = false
  ): Promise<MqttTokenResult> {
    homey.log(`Validate OTP`);

    const settingsKey = `stellantis_tokens_otpState_${brandName.toLowerCase()}`;
    let otpState = await homey.settings.get(settingsKey);

        // Als forceReset, verwijder oude state
    if (forceReset)
    {
      await homey.settings.unset(settingsKey);
      console.log('[RESET] OTP state geforceerd gereset');
      otpState = null;
    }
    else
    {
      otpState = await homey.settings.get(settingsKey);
    }

    //const baseUrl = 'https://mw-web-bff.mpsa.com';
    const baseUrl = 'https://api.groupe-psa.com';

    try {
      // ========================================================================
      // STAP 2 & 3: OTP OBJECT VERKRIJGEN (uit sessie of nieuw aanmaken)
      // ========================================================================
      
      let otp: Otp | null = null;
      
      // Probeer eerst uit sessie te laden
      if (otpState) {
        console.log('[STAP 3] OTP laden uit sessie...');
        try {
          otp = Otp.fromJSON(otpState);
          console.log('[STAP 3] ✓ OTP object succesvol geladen uit sessie');
        } catch (error) {
          console.log('[STAP 3] ✗ OTP state corrupt, opnieuw aanmaken nodig');
          otpState = null; // Force nieuwe setup
        }
      } 
      
      // Als geen state in sessie, maak nieuwe aan (STAP 2)
      if (!otpState) {
        console.log('[STAP 2] Geen OTP state in sessie, nieuwe sessie aanmaken...');
        
        // Check of SMS code en PIN zijn meegegeven
        if (!smsCode || !pinCode) {
          return {
            success: false,
            requiresSetup: true,
            error: 'Geen OTP state in sessie. SMS code en PIN vereist voor setup.'
          };
        }
        
        console.log(`[STAP 2] Aanmaken met SMS: ${smsCode}, PIN: ${pinCode.replace(/./g, '*')}`);
        
        // Maak nieuw OTP object met unieke device identifier
        const deviceIdentifier = `Homey_${brandName}/_/${crypto.randomBytes(16).toString('hex')}`;
        otp = new Otp('bb8e981582b0f31353108fb020bead1c', deviceIdentifier);
        
        // Zet SMS code en PIN
        otp['smsCode'] = smsCode;
        otp['codepin'] = pinCode;
        
        // Voer activatie uit
        console.log('[STAP 2] Starten activatie...');
        const activated = await otp.activationStart();

        if (!activated) {
          return {
            success: false,
            error: 'OTP activatie gefaald. Controleer SMS code en PIN.'
          };
        }
        
        console.log('[STAP 2] Finaliseren activatie...');
        const finalizeResult = await otp.activationFinalize();
        
        if (finalizeResult !== 0) { // 0 = Otp.OK
          console.error(`[STAP 2] Finalisatie gefaald met code: ${finalizeResult}`);
          return {
            success: false,
            error: `OTP activatie finalisatie gefaald: ${finalizeResult}`
          };
        }
        
        console.log('[STAP 2] ✓ OTP sessie succesvol aangemaakt');

                // ← VOEG DIT TOE!
        console.log('[SAVE] Saving state after activation...');
        //console.log('[SAVE] iwid before save:', otp.data.iwid);
        //console.log('[SAVE] iwTsync before save:', otp.data.iwTsync);
        const tempState = otp.toJSON();
        await homey.settings.set(settingsKey, tempState);
        console.log('[SAVE] State saved');
      }

      // ========================================================================
      // STAP 4: OTP CODE GENEREREN
      // ========================================================================
      
      console.log('[STAP 4] OTP code genereren...');
      console.log('[STAP 4] ⚠️  Rate limit: Max 6 keer per 24 uur');
      
      let otpCode: string|null;
      try {
        otpCode = await otp!.getOtpCode();
      } catch (error) {
        console.error('[STAP 4] ✗ OTP code generatie gefaald:', error);
        
        // Als het een ConfigException is, moet de gebruiker opnieuw authenticeren
        if (error instanceof ConfigException) {
          // Verwijder oude state
          await homey.settings.unset(settingsKey);
          
          return {
            success: false,
            requiresSetup: true,
            error: 'OTP sessie verlopen. Re-authenticatie vereist met nieuwe SMS code.'
          };
        }
        
        throw error;
      }
      
      if (!otpCode) {
        return {
          success: false,
          error: 'OTP code generatie gefaald. Mogelijk opnieuw authenticeren vereist.'
        };
      }
      
      console.log(`[STAP 4] ✓ OTP code gegenereerd: ${otpCode}`);

      // ========================================================================
      // STAP 5: MQTT CONNECTIE MAKEN MET OTP CODE
      // ========================================================================
      
      console.log('[STAP 5] MQTT connectie maken...');
      console.log(`[STAP 5] Server: mqtts://${MQTT_SERVER}:${MQTT_PORT}`);
      console.log(`[STAP 5] Username: ${this.config.customerId}`);
      console.log(`[STAP 5] Password: ${otpCode}`);
      
      const mqttConnectResult = await this.connectMQTT(otpCode);
      
      if (!mqttConnectResult.success) {
        return {
          success: false,
          error: `MQTT connectie gefaald: ${mqttConnectResult.error}`
        };
      }

      console.log('[STAP 5] ✓ MQTT connectie succesvol!');

      // ========================================================================
      // RESULTAAT
      // ========================================================================
      
      // Update OTP state in sessie
      const newOtpState = otp!.toJSON();
      await homey.settings.set(settingsKey, newOtpState);
      
      return {
        success: true,
        mqttClient: this.mqttClient!,
        otpCode: otpCode,
        otpState: newOtpState
      };

    } catch (error) {
      console.error('[ERROR]', error);
      
      if (error instanceof ConfigException) {
        await homey.settings.unset(settingsKey);
        
        return {
          success: false,
          requiresSetup: true,
          error: 'OTP configuratie is ongeldig. Re-authenticatie vereist.'
        };
      }

      return {
        success: false,
        error: `Onverwachte fout: ${(error as Error).message}`
      };
    }
  }

  /**
   * Get current remote credentials
   */
  getRemoteCredentials(): RemoteCredentials {
    return this.remoteCredentials;
  }

  /**
   * Check if remote token is still valid
   */
  isRemoteTokenValid(): boolean {
    if (!this.remoteCredentials.expiresAt) {
      return false;
    }
    
    // Check if token expires in more than 5 minutes
    return this.remoteCredentials.expiresAt > (Date.now() + 5 * 60 * 1000);
  }

  /**
   * Connect to MQTT broker
   */
  private async connectMQTT(otpCode: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const mqttUrl = `mqtts://${MQTT_SERVER}:${MQTT_PORT}`;
      const clientId = `Homey_${Date.now()}`;
      
      this.mqttClient = mqtt.connect(mqttUrl, {
        clientId: clientId,
        username: this.config.customerId,
        password: otpCode,
        keepalive: MQTT_KEEP_ALIVE,
        clean: true,
        rejectUnauthorized: true,
        protocol: 'mqtts',
        protocolVersion: 4,
        connectTimeout: 30000,
        reconnectPeriod: 0
      });

      this.mqttClient.on('connect', () => {
        console.log('[MQTT] ✓ Connected!');
        
        // Subscribe to topics
        const respTopic = `${MQTT_RESP_TOPIC}${this.config.customerId}/#`;
        const eventTopic = `${MQTT_EVENT_TOPIC}${this.config.customerId}/#`;
        
        this.mqttClient!.subscribe([respTopic, eventTopic], { qos: MQTT_QOS }, (err) => {
          if (err) {
            resolve({ success: false, error: `Subscription failed: ${err.message}` });
          } else {
            console.log(`[MQTT] ✓ Subscribed to topics`);
            resolve({ success: true });
          }
        });
      });

      this.mqttClient.on('error', (error) => {
        console.error('[MQTT] Error:', error);
        resolve({ success: false, error: error.message });
      });

      this.mqttClient.on('message', (topic, message) => {
        this.handleMqttMessage(topic, message);
      });
    });
  }

  /**
   * Handle MQTT messages
   */
  private handleMqttMessage(topic: string, message: Buffer): void {
    try {
      const payload = JSON.parse(message.toString());
      console.log('[MQTT] Message:', topic, payload);

      const correlationId = payload.correlation_id || payload.correlationId;
      
      if (correlationId && this.pendingRequests.has(correlationId)) {
        const request = this.pendingRequests.get(correlationId)!;
        clearTimeout(request.timeout);
        this.pendingRequests.delete(correlationId);
        
        if (payload.return_code === 'OK' || payload.status === 'SUCCESS') {
          request.resolve(payload);
        } else {
          request.reject(new Error(`Command failed: ${payload.return_code || payload.status}`));
        }
      }
    } catch (error) {
      console.error('[MQTT] Parse error:', error);
    }
  }

  /**
   * Send remote command
   */
  async sendRemoteCommand(
    vin: string,
    command: string,
    params: any = {}
  ): Promise<RemoteCommandResult> {
    if (!this.mqttClient || !this.mqttClient.connected) {
      return {
        success: false,
        error: 'MQTT not connected. Call validateOTP first.'
      };
    }

    const correlationId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const topic = `${MQTT_REQ_TOPIC}${this.config.customerId}`;

    const payload = {
      vin: vin,
      command: command,
      correlation_id: correlationId,
      ...params
    };

    console.log('[MQTT] Sending command:', command);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        resolve({
          success: false,
          error: 'Timeout - no response received'
        });
      }, 30000);

      this.pendingRequests.set(correlationId, {
        resolve: (response) => resolve({
          success: true,
          correlationId,
          response
        }),
        reject: (error) => resolve({
          success: false,
          correlationId,
          error: error.message
        }),
        timeout
      });

      this.mqttClient!.publish(topic, JSON.stringify(payload), { qos: MQTT_QOS }, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(correlationId);
          resolve({
            success: false,
            error: `Publish failed: ${error.message}`
          });
        }
      });
    });
  }

  /**
   * Disconnect MQTT
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.mqttClient) {
        this.mqttClient.end(false, {}, () => {
          console.log('[MQTT] Disconnected');
          this.mqttClient = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.mqttClient !== null && this.mqttClient.connected;
  }

  /**
   * Reconnect if needed (generates new OTP and reconnects)
   */
  async reconnectIfNeeded(homey: any, brandName: string, clientId: string): Promise<boolean> {
    if (this.isConnected()) {
      return true;
    }
    
    console.log('[MQTT] Not connected, reconnecting...');
    const result = await this.validateOTP(homey, null, null, brandName, clientId);
    return result.success;
  }

  /**
   * Refresh remote token if needed
   */
  async refreshRemoteTokenIfNeeded(homey: any, brandName: string, clientId: string): Promise<boolean> {
    if (this.isRemoteTokenValid()) {
      console.log('Remote token still valid, no refresh needed');
      return true;
    }
    
    console.log('Remote token expired or expiring soon, refreshing...');
    
    try {
      const result = await this.validateOTP(homey, null, null, brandName, clientId);
      return result.success;
    } catch (error) {
      console.error('Failed to refresh remote token:', error);
      return false;
    }
  }

  /**
   * Execute a remote command
   * @param command - Command to execute
   * @param vin - Vehicle VIN
   */
  async executeRemoteCommand(
    homey: any,
    brandName: string,
    clientId: string,
    command: string,
    vin: string,
    payload?: any
  ): Promise<any> {
    // Ensure we have a valid token
    const refreshed = await this.refreshRemoteTokenIfNeeded(homey, brandName, clientId);
    
    if (!refreshed) {
      throw new Error('Failed to refresh remote token. Re-authentication required.');
    }
    
    const apiHost = this.getAPIHost();
    const url = `https://${apiHost}/connectedcar/v4/user/vehicles/${vin}/${command}`;
    
    console.log(`Executing remote command: ${command}`);
    
    const response = await axios({
      method: 'POST',
      url: url,
      headers: {
        'Authorization': `Bearer ${this.remoteCredentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      data: payload || {},
      timeout: 30000
    });
    
    console.log(`✓ Command ${command} executed successfully`);
    return response.data;
  }
}