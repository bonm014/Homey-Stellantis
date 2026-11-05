import Homey from 'homey';
import fetch from 'node-fetch';
import type {TokenData} from './types' 
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { Vehicle, VehicleStatus, Maintenance, Trips, User } from './types'
import { StellantisRemoteClient } from './../src';

interface StellantisConfig {
    brand: string;
    country: string;
    locale: string;
    realm: string;
    baseUrl: string;
    client_id: string;
}

export class StellantisClient
{
    private brandName:string = ""
    private tokenRefreshInterval?: NodeJS.Timeout;
    private app:Homey.App;
    private tokens:TokenData | undefined = undefined;
    private axios!: AxiosInstance;
    public accessToken: string="";
    public country!:string;
    public locale!:string;
    private brandConfig!: StellantisConfig;
    private remoteClient?: StellantisRemoteClient;

    constructor(app:Homey.App, brandName:string)
    {
        this.brandName = brandName;
        this.app = app;

        this.updateConfig();
        
        this.tokenRefreshInterval = setInterval(() => {
            this.checkAndRefreshTokens();
        }, 1 * 60 * 1000);

        this.checkAndRefreshTokens();
    }

    async clearConfig()
    {
        this.tokens = undefined;
        this.accessToken = "";
        this.country = "";
        this.locale = "";

        this.app.homey.settings.set(`stellantis_tokens_${this.brandName.toLowerCase()}`, null);
        this.app.homey.settings.set(`stellantis_tokens`, null);
        this.app.homey.settings.unset(`stellantis_customer_id_${this.brandName.toLowerCase()}`);

        if (this.remoteClient)
        {
            this.remoteClient.disconnect().catch(() => {});
            this.remoteClient = undefined;
        }
    }

    async updateConfig(newTokens:TokenData | undefined = undefined)
    {
        if(newTokens != undefined)
        {
            this.tokens = newTokens;
            this.app.homey.settings.set(`stellantis_tokens_${this.brandName.toLowerCase()}`, newTokens);
        }
        else
        {
            this.tokens = this.app.homey.settings.get(`stellantis_tokens_${this.brandName.toLowerCase()}`) as TokenData | undefined;

            if (!this.tokens) {
                this.tokens = this.app.homey.settings.get('stellantis_tokens') as TokenData | undefined;
            }

            if(this.tokens == null || this.tokens == undefined)
            {
                return;
            }
        }

        this.accessToken = this.tokens!.accessToken;
        this.country = this.tokens!.country;
        this.locale = this.tokens!.locale;

        // Build brand config
        this.brandConfig = {
            brand: this.brandName,
            country: this.tokens!.country,
            locale: this.tokens!.locale,
            realm: this.buildRealm(this.brandName),
            baseUrl: 'https://api.groupe-psa.com/connectedcar/v4',
            client_id: this.tokens!.client_id
        };

        // Create Axios instance with defaults
        this.axios = axios.create({
            baseURL: this.brandConfig.baseUrl,
            timeout: 30000,
            headers: {
                'Accept': 'application/hal+json',
                'Authorization': `Bearer ${this.accessToken}`,
                'x-introspect-realm': this.brandConfig.realm
            }
        });
        
        // Add request interceptor for logging
        this.axios.interceptors.request.use(
            (config) => {
                return config;
            },
            (error) => {
                this.app.error('Request error:', error);
                return Promise.reject(error);
            }
        );
        
        // Add response interceptor for logging
        this.axios.interceptors.response.use(
            (response) => {
                /*
                this.homey.log('API Response:', {
                    status: response.status,
                    url: response.config.url    
                });
                this.homey.log(response);
*/

                return response;
            },
            (error) => {
                /*
                this.homey.error('Response error:', {
                    status: error.response?.status,
                    url: error.config?.url,
                    data: error.response?.data
                });
                */
                return Promise.reject(error);
            }
        );
    }

    destructor()
    {
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
        }
    }

    /**
     * The customer id used in the MQTT topics (NOT the e-mail address).
     * Comes from the car-associations endpoint, same as the Home Assistant integration.
     */
    public async getCustomerId(): Promise<string | undefined>
    {
        const key = `stellantis_customer_id_${this.brandName.toLowerCase()}`;
        const cached = this.app.homey.settings.get(key) as string | null | undefined;
        if (cached)
        {
            return cached;
        }

        if (this.brandConfig == undefined)
        {
            return undefined;
        }

        const url = `https://api.groupe-psa.com/applications/cvs/v4/mauv/car-associations?client_id=${encodeURIComponent(this.brandConfig.client_id)}&locale=${encodeURIComponent(this.locale)}`;
        const call = () => axios.get(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'User-Agent': 'okhttp/4.8.0',
                'Accept': 'application/hal+json',
                'x-introspect-realm': this.brandConfig.realm,
                'x-transaction-id': '1234'
            },
            timeout: 30000
        });

        try
        {
            let response: any;
            try
            {
                response = await call();
            }
            catch (error)
            {
                if (axios.isAxiosError(error) && error.response?.status === 401)
                {
                    await this.refreshTokens();
                    response = await call();
                }
                else
                {
                    throw error;
                }
            }

            const associations: any[] = Array.isArray(response.data) ? response.data : [];
            const customer = associations.find((a: any) => a && a.customer)?.customer as string | undefined;

            if (!customer)
            {
                this.app.error(`${this.brandName} No customer found in car-associations`);
                return undefined;
            }

            this.app.homey.settings.set(key, customer);
            return customer;
        }
        catch (error)
        {
            this.app.error(`${this.brandName} Unable to get the customer id: ${(error as Error).message}`);
            return undefined;
        }
    }

    public async getRemoteClient()
    {
        if (this.tokens == undefined)
        {
            this.updateConfig();
        }

        if (this.tokens == undefined)
        {
            this.app.error(`${this.brandName} No tokens available, please login first`);
            return;
        }

        // Only refresh when needed: the refresh token rotates on every use
        await this.checkAndRefreshTokens();

        // One remote client per brand: it keeps the MQTT connection and the OTP/MQTT token state
        if (this.remoteClient)
        {
            this.remoteClient.updateOAuthToken(this.accessToken);
            return this.remoteClient;
        }

        const tokens:TokenData = this.app.homey.settings.get('stellantis_tokens_' + this.brandName.toLowerCase()) || this.tokens;

        const customerId = await this.getCustomerId();
        if (!customerId)
        {
            return;
        }

        var remoteClient:StellantisRemoteClient = new StellantisRemoteClient({
            accessToken: this.accessToken,
            clientId:tokens.client_id,
            clientSecret:tokens.client_secret,
            countryCode: this.country,
            locale: tokens.locale || this.locale,
            customerId: customerId,
            realm:`clientsB2C${this.brandName.replace('My', '')}`
        },   async () => {
                // Refresh the OAuth token and return the new one
                await this.refreshTokens();
                return this.accessToken;
            }
        );

        // The vehicle events are subscribed per VIN
        try
        {
            const vehicles = await this.getVehicles();
            remoteClient.setVins(vehicles.map((v: Vehicle) => v.vin));

            // Log the stored remote services (looked up at the OTP activation/refresh, no network call)
            for (const vehicle of vehicles)
            {
                const stored = this.getStoredVehicleRights(vehicle.vin);
                if (stored)
                {
                    this.logRights(vehicle.vin, stored);
                }
            }
        }
        catch (error)
        {
            this.app.error(`${this.brandName} Unable to get the vehicles for the MQTT subscriptions: ${(error as Error).message}`);
        }

        remoteClient.init(this.app.homey, this.brandName);
        this.remoteClient = remoteClient;

        return remoteClient;
    }

    private rightsStoreKey(): string
    {
        return `stellantis_rights_${this.brandName.toLowerCase()}`;
    }

    /**
     * The stored remote services of a vehicle, or undefined when they were never looked up.
     * A car does not change its capabilities, so they are stored permanently and only
     * looked up again after an OTP activation or refresh (see refreshVehicleRights).
     */
    public getStoredVehicleRights(vin: string): { code: string, name?: string, mqtt_services: string[] }[] | undefined
    {
        const stored = (this.app.homey.settings.get(this.rightsStoreKey()) || {}) as { [vin: string]: { services: { code: string, name?: string, mqtt_services: string[] }[] } };
        return stored[vin]?.services;
    }

    /**
     * Looks up the remote services of every vehicle and stores them. Called after a successful OTP
     * activation or refresh. Failures are logged and keep the previously stored services.
     */
    public async refreshVehicleRights(): Promise<void>
    {
        try
        {
            const vehicles = await this.getVehicles();
            for (const vehicle of vehicles)
            {
                try
                {
                    const services = await this.fetchVehicleRights(vehicle.vin);
                    this.storeVehicleRights(vehicle.vin, services);
                    this.logRights(vehicle.vin, services);
                }
                catch (error)
                {
                    this.app.error(`${this.brandName} Unable to look up the vehicle rights: ${(error as Error).message}`);
                }
            }
        }
        catch (error)
        {
            this.app.error(`${this.brandName} Unable to look up the vehicle rights: ${(error as Error).message}`);
        }
    }

    /**
     * The remote services of a vehicle: always the stored ones. Only when nothing is stored yet
     * (an account that was activated before this was stored) they are looked up once.
     * Throws when nothing is stored and the lookup fails.
     */
    public async getVehicleRights(vin: string): Promise<{ code: string, name?: string, mqtt_services: string[] }[]>
    {
        const stored = this.getStoredVehicleRights(vin);
        if (stored)
        {
            return stored;
        }

        const services = await this.fetchVehicleRights(vin);
        this.storeVehicleRights(vin, services);
        this.logRights(vin, services);
        return services;
    }

    private storeVehicleRights(vin: string, services: { code: string, name?: string, mqtt_services: string[] }[]): void
    {
        const stored = (this.app.homey.settings.get(this.rightsStoreKey()) || {}) as { [vin: string]: any };
        stored[vin] = { at: Date.now(), services: services };
        this.app.homey.settings.set(this.rightsStoreKey(), stored);
    }

    private logRights(vin: string, services: { code: string, name?: string, mqtt_services: string[] }[]): void
    {
        const found = services.map(s => `${s.code}${s.name ? ' (' + s.name + ')' : ''}${s.mqtt_services.length > 0 ? ' [' + s.mqtt_services.join(', ') + ']' : ''}`);
        this.app.log(`${this.brandName} Remote services for ${vin}: ${found.length > 0 ? found.join('; ') : 'none found / unknown format'}`);
    }

    /**
     * The unprocessed answer of the rights endpoint (used to explore what a service offers).
     */
    public async getRawVehicleRights(vin: string): Promise<any>
    {
        if (this.tokens == undefined || this.brandConfig == undefined)
        {
            this.updateConfig();
        }
        if (this.brandConfig == undefined)
        {
            throw new Error('Not logged in');
        }

        await this.checkAndRefreshTokens();

        const brandConfig = this.brandConfig;
        const url = `https://api.groupe-psa.com/applications/cvs/v4/rights/vehicle/${encodeURIComponent(vin)}?client_id=${encodeURIComponent(brandConfig.client_id)}`;
        const call = () => axios.get(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'User-Agent': 'okhttp/4.8.0',
                'Accept': 'application/json',
                'x-introspect-realm': brandConfig.realm,
                'x-transaction-id': '1234'
            },
            timeout: 30000
        });

        let response: any;
        try
        {
            response = await call();
        }
        catch (error)
        {
            if (axios.isAxiosError(error) && error.response?.status === 401)
            {
                await this.refreshTokens();
                response = await call();
            }
            else
            {
                throw error;
            }
        }

        return response.data;
    }

    private async fetchVehicleRights(vin: string): Promise<{ code: string, name?: string, mqtt_services: string[] }[]>
    {
        const data = await this.getRawVehicleRights(vin);

        const services: { code: string, name?: string, mqtt_services: string[] }[] = [];
        const byUnit = data?.services;
        if (byUnit && typeof byUnit === 'object')
        {
            for (const list of Object.values(byUnit) as any[])
            {
                for (const service of Array.isArray(list) ? list : [])
                {
                    if (service && service.code && !services.some(x => x.code === service.code))
                    {
                        services.push({
                            code: String(service.code),
                            name: service.name ? String(service.name) : undefined,
                            mqtt_services: Array.isArray(service.mqtt_services) ? service.mqtt_services.map(String) : []
                        });
                    }
                }
            }
        }

        return services;
    }

    public async checkAndRefreshTokens()
    {
        //this.app.log(`${this.brandName} Checking if tokens need refresh`);
        
        let tokens = this.app.homey.settings.get('stellantis_tokens_' + this.brandName.toLowerCase()) as TokenData | undefined;
        
        if (!tokens) {
            tokens = this.app.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        }
        
        if (!tokens) {
            //this.app.log(`${this.brandName} No tokens found`);
            return;
        }

        //console.log(tokens);

        if(this.accessToken == "")
        {
            this.updateConfig();
        }
        
        // Refresh if expires in less than 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        const needsRefresh = tokens.expiresAt - Date.now() < fiveMinutes;
        
        if (needsRefresh) {
            //this.app.log(`${this.brandName} Token needs refresh, refreshing...`);
            try
            {
                await this.refreshTokens();
            }
            catch{}
        } else {
            //this.app.log(`${this.brandName} Token still valid`);
        }


    }

        /**
     * Refresh tokens (internal use)
     */
    private refreshPromise?: Promise<void>;

    async refreshTokens(): Promise<void> {
        // The refresh token rotates on every use: never refresh twice at the same time
        if (this.refreshPromise)
        {
            return this.refreshPromise;
        }

        this.refreshPromise = this.doRefreshTokens().finally(() => {
            this.refreshPromise = undefined;
        });

        return this.refreshPromise;
    }

    private async doRefreshTokens(): Promise<void> {
        let tokens = null;
        try {
            tokens = this.app.homey.settings.get('stellantis_tokens_' + this.brandName.toLowerCase()) as TokenData | undefined;
            
            if (!tokens || !tokens.refreshToken) {
                //try the iold token storage
                tokens = this.app.homey.settings.get('stellantis_tokens') as TokenData | undefined;
            }
            
            if (!tokens || !tokens.refreshToken) {
                throw new Error(`${this.brandName} No refresh token found`);
            }

            // Create Basic Auth header
            const credentials = Buffer.from(`${tokens.client_id}:${tokens.client_secret}`).toString('base64');
            
            const response = await fetch(`${tokens.oauth_url}/am/oauth2/access_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: tokens.refreshToken
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            const actualAccessToken = data.access_token;
            
            // Update tokens
            tokens.accessToken = actualAccessToken;
            tokens.refreshToken = data.refresh_token || tokens.refreshToken;
            tokens.expiresIn = data.expires_in;
            tokens.expiresAt = Date.now() + (data.expires_in * 1000);
            tokens.lastRefresh = Date.now();

            this.updateAccessToken(actualAccessToken);
            
            this.app.homey.settings.set('stellantis_tokens_' + this.brandName.toLowerCase(), tokens);
            this.tokens = tokens;
            this.app.log(`${this.brandName} Token refreshed successfully`);
            
        } catch (error) {
            this.app.error(`${this.brandName} Error refreshing token: ${(error as Error).message}`);
        }
    }

    /**
     * Get current valid access token
     * For use by drivers
     */
    async getAccessToken(): Promise<string> {
        if (this.tokens == undefined) {
            throw new Error(`${this.brandName} No tokens available. Please configure your account in settings.`);
        }
        
        // Check if token needs refresh
        const fiveMinutes = 5 * 60 * 1000;
        if (this.tokens.expiresAt - Date.now() < fiveMinutes) {
            this.app.log(`${this.brandName} Token expired or expiring soon, refreshing...`);

            try
            {
                await this.refreshTokens();
            }
            catch{}

            //Get the latest token (no recursion: a failed refresh must not loop forever)
            return this.tokens.accessToken;
        }
        
        return this.tokens.accessToken;
    }

    /**
     * Get Stellantis API client info
     * For use by drivers
     *
    private getStellantisClient(): StellantisClient {
        if (this.tokens == undefined) {
            throw new Error(`${this.brandName} No tokens available`);
        }
        
        return {
            brand: this.tokens.brand,
            country: this.tokens.country,
            oauth_url: this.tokens.oauth_url,
            clientid: this.tokens.client_id,
            clientSecret: this.tokens.client_secret,
            getAccessToken: () => this.getAccessToken()
        };
    }

    async getStellantisApiClient():Promise<StellantisApiClient>
    {
        if (this.tokens == undefined) {
            throw new Error(`${this.brandName} No tokens available`);
        }
        /*
        return {
            brand: this.tokens.brand,
            country: this.tokens.country,
            oauth_url: this.tokens.oauth_url,
            clientid: this.tokens.client_id,
            clientSecret: this.tokens.client_secret,
            getAccessToken: () => this.getAccessToken()
        };
*

        return new StellantisApiClient(this.app, await this.getAccessToken(), this.tokens.brand, this.tokens.country,this.tokens.client_id);
    }
*/
    /**
     * Build realm name from brand
     * MyPeugeot → clientsB2CPeugeot
     */
    private buildRealm(brand: string): string {
        return `clientsB2C${brand.replace('My', '')}`;
    }
    
    /**
     * Make authenticated API request
     */
    private async request<T>(method: string, endpoint: string, data?: any): Promise<T> {

        // Add client_id as query parameter (API requires it in URL, not header)
        const separator = endpoint.includes('?') ? '&' : '?';
        const urlWithClientId = `${endpoint}${separator}client_id=${this.brandConfig.client_id}`;

        //console.log(`${urlWithClientId}`);

        const config: AxiosRequestConfig = {
            method,
            url: urlWithClientId,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'x-introspect-realm': this.brandConfig.realm
            }
        };
        
        if (data) {
            config.data = data;
        }
        
        try
        {
            const response = await this.axios.request<T>(config);
            return response.data;
        }
        catch
        {
            return <T>null;
        }
    }
    
    /**
     * Get user vehicles
     */
    async getVehicles(): Promise<Vehicle[]> {
        try {
            const response = await this.request<any>('GET', '/user/vehicles');

            // Response can be in different formats
            const vehicles = response._embedded.vehicles || [];

            //console.log(vehicles);
            
            return vehicles.map((v: Vehicle) => ({
                id: v.id,
                vin: v.vin,
                brand: v.brand,
                motorization: v.motorization,
                pictures: v.pictures
            }));
        } catch (error) {
            this.app.error('Error fetching vehicles:', error);
            
            if (axios.isAxiosError(error) && error.response?.status === 401) {
                throw new Error('Unauthorized: Token may be invalid or expired');
            }
            
            throw error;
        }
    }
    
    /**
     * Get vehicle last position (if available)
     */
    async getVehiclePosition(vehicleId: string): Promise<any> {
        try
        {
            return await this.request('GET', `/user/vehicles/${vehicleId}/lastPosition`);
        }
        catch (error)
        {
            return null;
        }
    }

    /**
     * Get vehicle status
     */
    async getVehicleStatus(vehicleId: string): Promise<VehicleStatus | null> {
        try
        {
            return this.request('GET', `/user/vehicles/${vehicleId}/status`);
        }
        catch
        {
            return null;
        }
    }
    
    /**
     * Get vehicle alarms
     */
    async getUser(): Promise<User | null> {
        try
        {
            return this.request('GET', `/user`);
        }
        catch
        {
            return null;
        }
    }

    async getVehicle(vehicleId: string): Promise<Vehicle | null> {
        try
        {
            return this.request('GET', `/user/vehicles/${vehicleId}`);
        }
        catch
        {
            return null;
        }
    }
    
    async getVehicleLastTrips(vehicleId: string): Promise<Trips | null> {
        try
        {
            var tripsFirstPage:any = await this.request('GET', `/user/vehicles/${vehicleId}/trips`);

            let lastPageUrl = (tripsFirstPage._links.last.href as string).replace(this.brandConfig.baseUrl,"");

            return this.request('GET', lastPageUrl);
        }
        catch
        {
            return null;
        }
    }

    async getVehicleAlarms(vehicleId: string): Promise<any> {
        try
        {
            return this.request('GET', `/user/vehicles/${vehicleId}/alarms`);
        }
        catch
        {
            return null;
        }
    }

    async getVehicleMaintenance(vehicleId: string): Promise<Maintenance | null> {
        try
        {
            return this.request('GET', `/user/vehicles/${vehicleId}/maintenance`);
        }
        catch
        {
            return null;
        }
    }
    /**
     * Update access token
     */
    updateAccessToken(newToken: string): void {
        this.accessToken = newToken;
    }
}