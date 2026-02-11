// lib/stellantis-api-client.ts
// Complete Stellantis API client with Axios

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { Vehicle, VehicleStatus, Maintenance, Trips } from './types'

interface HomeyApp {
    log: (...args: any[]) => void;
    error: (...args: any[]) => void;
}

interface StellantisConfig {
    brand: string;
    country: string;
    realm: string;
    baseUrl: string;
    client_id: string;
}

export class StellantisApiClient {
    private axios: AxiosInstance;
    private accessToken: string;
    private brandConfig: StellantisConfig;
    private homey: HomeyApp;

    constructor(homey: HomeyApp, accessToken: string, brand: string, country: string, client_id: string) {
        this.homey = homey;
        this.accessToken = accessToken;
        
        // Build brand config
        this.brandConfig = {
            brand: brand,
            country: country,
            realm: this.buildRealm(brand),
            baseUrl: 'https://api.groupe-psa.com/connectedcar/v4',
            client_id: client_id
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
                this.homey.error('Request error:', error);
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
            this.homey.error('Error fetching vehicles:', error);
            
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
    async getVehicle(vehicleId: string): Promise<any> {
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