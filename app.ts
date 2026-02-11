import Homey from 'homey';
import fetch from 'node-fetch';
import { TokenData, StellantisClient } from './types';

class StellantisApp extends Homey.App {
    
    private tokenRefreshInterval?: NodeJS.Timeout;

    async onInit(): Promise<void> {
        this.log('Stellantis app has been initialized');
        
        // API endpoints are automatically loaded from api.ts
        // No manual registration needed in SDK 3
        
        // Start token refresh checker (every hour)
        this.tokenRefreshInterval = setInterval(() => {
            this.checkAndRefreshTokens('MyPeugeot');
            this.checkAndRefreshTokens('MyCitroen');
            this.checkAndRefreshTokens('MyOpel');
        }, 60 * 15 * 1000);

        this.checkAndRefreshTokens('MyPeugeot');
        this.checkAndRefreshTokens('MyCitroen');
        this.checkAndRefreshTokens('MyOpel');
    }

    /**
     * Check tokens and refresh if needed
     * Runs every hour
     */
    async checkAndRefreshTokens(brand:string): Promise<void> {
        this.log(`${brand} Checking if tokens need refresh`);
        
        let tokens = this.homey.settings.get('stellantis_tokens_' + brand.toLowerCase()) as TokenData | undefined;
        
        if (!tokens) {
            tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        }
        
        if (!tokens) {
            this.log(`${brand} No tokens found`);
            return;
        }
        
        // Refresh if expires in less than 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        const needsRefresh = tokens.expiresAt - Date.now() < fiveMinutes;
        
        if (needsRefresh) {
            this.log(`${brand} Token needs refresh, refreshing...`);
            await this.refreshTokens(brand);
        } else {
            this.log(`${brand} Token still valid`);
        }
    }

    /**
     * Refresh tokens (internal use)
     */
    async refreshTokens(brand:string): Promise<void> {
        try {
            let tokens = this.homey.settings.get('stellantis_tokens_' + brand.toLowerCase()) as TokenData | undefined;
            
            if (!tokens || !tokens.refreshToken) {
                //try the iold token storage
                tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
            }
            
            if (!tokens || !tokens.refreshToken) {
                throw new Error(`${brand} No refresh token found`);
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
            
            this.homey.settings.set('stellantis_tokens_' + brand.toLowerCase(), tokens);
            this.log(`${brand} Token refreshed successfully`);
            
        } catch (error) {
            this.error(`${brand} Error refreshing token:`, error);
        }
    }

    /**
     * Get current valid access token
     * For use by drivers
     */
    async getAccessToken(brand:string): Promise<string> {
        let tokens = this.homey.settings.get('stellantis_tokens_' + brand.toLowerCase()) as TokenData | undefined;

        //Try the old cached token
        if (!tokens) {
            tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        }
        if (!tokens) {
            throw new Error(`${brand} No tokens available. Please configure your account in settings.`);
        }
        
        // Check if token needs refresh
        const fiveMinutes = 5 * 60 * 1000;
        if (tokens.expiresAt - Date.now() < fiveMinutes) {
            this.log(`${brand} Token expired or expiring soon, refreshing...`);
            await this.refreshTokens(brand);

            //Get the latest token
            return await this.getAccessToken(brand);
        }
        
        return tokens.accessToken;
    }

    /**
     * Get Stellantis API client info
     * For use by drivers
     */
    getStellantisClient(brand:string): StellantisClient {
        let tokens = this.homey.settings.get('stellantis_tokens_' + brand.toLowerCase()) as TokenData | undefined;

        if (!tokens) {
            tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        }
        
        if (!tokens) {
            throw new Error(`${brand} No tokens available`);
        }
        
        return {
            brand: tokens.brand,
            country: tokens.country,
            oauth_url: tokens.oauth_url,
            clientid: tokens.client_id,
            getAccessToken: () => this.getAccessToken(brand.toLowerCase())
        };
    }

    async onUninit(): Promise<void> {
        this.log('Stellantis app is shutting down');
        
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
        }
    }
}

export = StellantisApp;