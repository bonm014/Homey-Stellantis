import * as crypto from 'crypto';
import * as https from 'https';
import * as mqtt from 'mqtt';

/**
 * Configuration for Stellantis Remote Client
 */
export interface StellantisConfig {
  realm: string;
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
  private otpCode: string | null;

  constructor(config: StellantisConfig) {
    this.config = config;
    this.remoteCredentials = {
      refreshToken: null,
      accessToken: null,
      expiresAt: null
    };
    this.mqttClient = null;
    this.otpCode = null;
  }

  /**
   * Generate code verifier for PKCE (Proof Key for Code Exchange)
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate code challenge from verifier
   */
  private generateCodeChallenge(verifier: string): string {
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }

  /**
   * Make HTTPS request
   */
  private async makeRequest(
    hostname: string,
    path: string,
    method: string,
    data: string,
    headers: { [key: string]: string | number }
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          ...headers
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk;
        });
        
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            resolve(response);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${(error as Error).message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Step 1: Request OTP SMS
   * This triggers an SMS to be sent to the phone number associated with the account
   */
  async requestOTP(): Promise<void> {
    const baseUrl = this.getBaseUrl();
    
    const data = JSON.stringify({
      siteCode: this.config.realm.replace('clientsB2C', '').toLowerCase(),
      culture: `${this.config.countryCode.toLowerCase()}-${this.config.countryCode}`,
      action: 'AUTHENTICATE',
      fields: {
        USR_EMAIL: { value: this.config.customerId }
      }
    });

    const headers = {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'x-introspect-realm': this.config.realm
    };

    const response: OTPResponse = await this.makeRequest(
      baseUrl,
      '/GetAccessToken',
      'POST',
      data,
      headers
    );

    // Check for errors
    if (response.err) {
      if (response.err === 'NOK:MAXNBTOOLS') {
        throw new Error('Maximum number of devices/SMS reached. Please reset your Stellantis account.');
      } else if (response.err === 'NOK:FORBIDDEN') {
        throw new Error('Forbidden. Please re-authenticate your account.');
      } else {
        throw new Error(`OTP request failed: ${response.err}`);
      }
    }
    
    console.log('OTP SMS sent successfully. Check your phone.');
  }

  /**
   * Step 2: Validate OTP Code with PIN
   * @param smsCode - 4-digit code received via SMS
   * @param pin - 4-digit PIN from mobile app
   */
  async validateOTP(smsCode: string, pin: string): Promise<RemoteCredentials> {
    if (!smsCode || smsCode.length === 0) {
      throw new Error('SMS code must be set');
    }
    if (!pin || pin.length !== 4) {
      throw new Error('PIN must be 4 digits');
    }

    const baseUrl = this.getBaseUrl();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Combine SMS code and PIN
    this.otpCode = smsCode + pin;

    const data = JSON.stringify({
      siteCode: this.config.realm.replace('clientsB2C', '').toLowerCase(),
      culture: `${this.config.countryCode.toLowerCase()}-${this.config.countryCode}`,
      action: 'AUTHENTICATE',
      fields: {
        USR_EMAIL: { value: this.config.customerId },
        USR_PASSWORD: { value: this.otpCode }
      },
      codeVerifier: codeVerifier,
      codeChallenge: codeChallenge
    });

    const headers = {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'x-introspect-realm': this.config.realm
    };

    const response: OTPResponse = await this.makeRequest(
      baseUrl,
      '/GetAccessToken',
      'POST',
      data,
      headers
    );

    // Check for errors
    if (response.err) {
      if (response.err === 'NOK:NOK_BLOCKED') {
        throw new Error('Too many wrong PIN attempts. Account blocked.');
      } else {
        throw new Error(`OTP validation failed: ${response.err}`);
      }
    }

    // Store remote tokens
    if (response.access_token && response.refresh_token) {
      this.remoteCredentials.accessToken = response.access_token;
      this.remoteCredentials.refreshToken = response.refresh_token;
      this.remoteCredentials.expiresAt = Date.now() + (response.expires_in! * 1000);
      
      console.log('Remote access tokens obtained successfully!');
      return { ...this.remoteCredentials };
    } else {
      throw new Error('Response missing access_token or refresh_token');
    }
  }

  /**
   * Refresh remote access token using refresh token
   */
  async refreshRemoteToken(): Promise<RemoteCredentials> {
    if (!this.remoteCredentials.refreshToken) {
      throw new Error('No refresh token available. Please complete OTP flow first.');
    }

    const baseUrl = this.getBaseUrl();
    
    const data = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: this.remoteCredentials.refreshToken
    });

    const headers = {
      'Authorization': `Bearer ${this.config.accessToken}`
    };

    const response: OTPResponse = await this.makeRequest(
      baseUrl,
      '/oauth/token',
      'POST',
      data,
      headers
    );

    if (response.err) {
      throw new Error(`Token refresh failed: ${response.err}`);
    }

    if (response.access_token) {
      this.remoteCredentials.accessToken = response.access_token;
      
      if (response.refresh_token) {
        this.remoteCredentials.refreshToken = response.refresh_token;
      }
      
      if (response.expires_in) {
        this.remoteCredentials.expiresAt = Date.now() + (response.expires_in * 1000);
      }
      
      console.log('Remote token refreshed successfully');
      return { ...this.remoteCredentials };
    } else {
      throw new Error('Response missing access_token');
    }
  }

  /**
   * Check if remote token needs refresh
   */
  needsTokenRefresh(): boolean {
    if (!this.remoteCredentials.expiresAt) {
      return true;
    }
    // Refresh if token expires in less than 5 minutes
    return Date.now() >= (this.remoteCredentials.expiresAt - 300000);
  }

  /**
   * Initialize MQTT connection for remote commands
   */
  async initializeMQTT(): Promise<mqtt.MqttClient> {
    if (!this.remoteCredentials.accessToken) {
      throw new Error('No remote access token. Complete OTP flow first.');
    }

    const mqttUrl = this.getMQTTUrl();
    
    const options: mqtt.IClientOptions = {
      clientId: `psa-${this.config.customerId}`,
      username: this.config.customerId,
      password: this.remoteCredentials.accessToken,
      protocol: 'mqtts',
      port: 8885,
      clean: true,
      protocolVersion: 4
    };

    return new Promise((resolve, reject) => {
      this.mqttClient = mqtt.connect(mqttUrl, options);

      this.mqttClient.on('connect', () => {
        console.log('MQTT connected successfully');
        
        // Subscribe to response topics
        const topic = `psa/RemoteServices/to/cid/${this.config.customerId}/#`;
        this.mqttClient!.subscribe(topic, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log(`Subscribed to topic: ${topic}`);
            resolve(this.mqttClient!);
          }
        });
      });

      this.mqttClient.on('error', (error) => {
        console.error('MQTT error:', error);
        reject(error);
      });

      this.mqttClient.on('message', (topic, message) => {
        console.log(`Received message on ${topic}:`, message.toString());
      });
    });
  }

  /**
   * Send remote command via MQTT
   * @param vin - Vehicle VIN
   * @param command - Command type (e.g., 'VehCharge', 'Precondition')
   * @param payload - Command payload
   */
  async sendRemoteCommand(
    vin: string,
    command: string,
    payload: Partial<CommandPayload> = {}
  ): Promise<void> {
    if (!this.mqttClient || !this.mqttClient.connected) {
      await this.initializeMQTT();
    }

    if (this.needsTokenRefresh()) {
      await this.refreshRemoteToken();
    }

    const topic = `psa/RemoteServices/from/cid/${this.config.customerId}/${command}`;
    
    const message = JSON.stringify({
      vin,
      ...payload
    });

    return new Promise((resolve, reject) => {
      this.mqttClient!.publish(topic, message, { qos: 1 }, (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`Command sent: ${command} for VIN ${vin}`);
          resolve();
        }
      });
    });
  }

  /**
   * Start charging
   */
  async startCharging(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'VehCharge', {
      action: 'start'
    });
  }

  /**
   * Stop charging
   */
  async stopCharging(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'VehCharge', {
      action: 'stop'
    });
  }

  /**
   * Set charging limit
   * @param vin - Vehicle VIN
   * @param percentage - Target charge percentage (0-100)
   */
  async setChargingLimit(vin: string, percentage: number): Promise<void> {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }

    return this.sendRemoteCommand(vin, 'VehCharge', {
      action: 'setChargeLimit',
      percentage
    });
  }

  /**
   * Start climate preconditioning
   * @param vin - Vehicle VIN
   * @param temperature - Target temperature in Celsius
   */
  async startPreconditioning(vin: string, temperature: number = 21): Promise<void> {
    return this.sendRemoteCommand(vin, 'Precondition', {
      action: 'start',
      temperature
    });
  }

  /**
   * Stop climate preconditioning
   */
  async stopPreconditioning(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'Precondition', {
      action: 'stop'
    });
  }

  /**
   * Wake up vehicle
   */
  async wakeUp(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'VehCharge', {
      action: 'state'
    });
  }

  /**
   * Lock doors
   */
  async lockDoors(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'Doors', {
      action: 'lock'
    });
  }

  /**
   * Unlock doors
   */
  async unlockDoors(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'Doors', {
      action: 'unlock'
    });
  }

  /**
   * Honk horn
   */
  async honkHorn(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'Horn', {
      action: 'activate'
    });
  }

  /**
   * Flash lights
   */
  async flashLights(vin: string): Promise<void> {
    return this.sendRemoteCommand(vin, 'Lights', {
      action: 'flash'
    });
  }

  /**
   * Get base URL for realm
   */
  private getBaseUrl(): string {
    const realmUrls: { [key: string]: string } = {
      'clientsB2CPeugeot': 'idpconfigadapter.peugeot.com',
      'clientsB2CCitroen': 'idpconfigadapter.citroen.com',
      'clientsB2CDS': 'idpconfigadapter.driveds.com',
      'clientsB2COpel': 'idpconfigadapter.opel.com',
      'clientsB2CVauxhall': 'idpconfigadapter.vauxhall.co.uk'
    };

    return realmUrls[this.config.realm] || 'idpconfigadapter.peugeot.com';
  }

  /**
   * Get MQTT URL for realm
   */
  private getMQTTUrl(): string {
    return 'mqtts://mwa-mobile-iot.mpsa.com:8885';
  }

  /**
   * Disconnect MQTT client
   */
  disconnect(): void {
    if (this.mqttClient) {
      this.mqttClient.end();
      console.log('MQTT disconnected');
    }
  }

  /**
   * Get current credentials (for saving to config)
   */
  getCredentials(): RemoteCredentials {
    return { ...this.remoteCredentials };
  }

  /**
   * Restore credentials from saved config
   */
  restoreCredentials(credentials: Partial<RemoteCredentials>): void {
    if (credentials.refreshToken) {
      this.remoteCredentials.refreshToken = credentials.refreshToken;
    }
    if (credentials.accessToken) {
      this.remoteCredentials.accessToken = credentials.accessToken;
    }
    if (credentials.expiresAt) {
      this.remoteCredentials.expiresAt = credentials.expiresAt;
    }
  }
}

export default StellantisRemoteClient;