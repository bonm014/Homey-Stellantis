import Homey from 'homey';
import fetch from 'node-fetch';
import type {TokenData} from './types' 
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { Vehicle, VehicleStatus, Maintenance, Trips, User } from './types'

interface StellantisConfig {
    brand: string;
    country: string;
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
    private brandConfig!: StellantisConfig;

    constructor(app:Homey.App, brandName:string)
    {
        this.brandName = brandName;
        this.app = app;

        this.updateConfig();
        
        this.tokenRefreshInterval = setInterval(() => {
            this.checkAndRefreshTokens();
        }, 5000 /*60 * 15 * 1000*/);

        this.checkAndRefreshTokens();
    }

    async updateConfig()
    {
        this.tokens = this.app.homey.settings.get(`stellantis_tokens_${this.brandName.toLowerCase()}`) as TokenData | undefined;

        if(this.tokens == null || this.tokens == undefined)
        {
            return;
        }


        this.accessToken = this.tokens!.accessToken;
        this.country = this.tokens!.country;

        // Build brand config
        this.brandConfig = {
            brand: this.brandName,
            country: this.tokens!.country,
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

    public async checkAndRefreshTokens()
    {
        this.app.log(`${this.brandName} Checking if tokens need refresh`);
        
        let tokens = this.app.homey.settings.get('stellantis_tokens_' + this.brandName.toLowerCase()) as TokenData | undefined;
        
        if (!tokens) {
            tokens = this.app.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        }
        
        if (!tokens) {
            this.app.log(`${this.brandName} No tokens found`);
            return;
        }

        if(this.accessToken == "")
        {
            this.updateConfig();
        }
        
        // Refresh if expires in less than 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        const needsRefresh = tokens.expiresAt - Date.now() < fiveMinutes;
        
        if (needsRefresh) {
            this.app.log(`${this.brandName} Token needs refresh, refreshing...`);
            try
            {
                await this.refreshTokens();
            }
            catch{}
        } else {
            this.app.log(`${this.brandName} Token still valid`);
        }

        this.updateAccessToken(tokens.accessToken);        
    }

        /**
     * Refresh tokens (internal use)
     */
    async refreshTokens(): Promise<void> {
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
            this.app.log(`${this.brandName} Token refreshed successfully`);
            
        } catch (error) {
            this.app.error(`${this.brandName} Error refreshing token:`);
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

            //Get the latest token
            return await this.getAccessToken();
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
        
        const response = await this.axios.request<T>(config);
        return response.data;
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
    async getVehicleStatus(vehicleId: string): Promise<VehicleStatus> {
        return this.request('GET', `/user/vehicles/${vehicleId}/status`);
    }
    
    /**
     * Get vehicle alarms
     */
    async getUser(): Promise<User> {
        return this.request('GET', `/user`);
    }

    async getVehicle(vehicleId: string): Promise<Vehicle> {
        return this.request('GET', `/user/vehicles/${vehicleId}`);
    }
    
    async getVehicleLastTrips(vehicleId: string): Promise<Trips> {
        var tripsFirstPage:any = await this.request('GET', `/user/vehicles/${vehicleId}/trips`);

        let lastPageUrl = (tripsFirstPage._links.last.href as string).replace(this.brandConfig.baseUrl,"");

        return this.request('GET', lastPageUrl);
    }

    async getVehicleAlarms(vehicleId: string): Promise<any> {
        return this.request('GET', `/user/vehicles/${vehicleId}/alarms`);
    }

    async getVehicleMaintenance(vehicleId: string): Promise<Maintenance> {
        return this.request('GET', `/user/vehicles/${vehicleId}/maintenance`);
    }
    /**
     * Update access token
     */
    updateAccessToken(newToken: string): void {
        this.accessToken = newToken;
    }
}