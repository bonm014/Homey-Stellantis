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
            this.checkAndRefreshTokens();
        }, 60 * 15 * 1000);

        this.checkAndRefreshTokens();
    }

    /**
     * Check tokens and refresh if needed
     * Runs every hour
     */
    async checkAndRefreshTokens(): Promise<void> {
        this.log('Checking if tokens need refresh');
        
        const tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        
        if (!tokens) {
            this.log('No tokens found');
            return;
        }
        
        // Refresh if expires in less than 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        const needsRefresh = tokens.expiresAt - Date.now() < fiveMinutes;
        
        if (needsRefresh) {
            this.log('Token needs refresh, refreshing...');
            await this.refreshTokens();
        } else {
            this.log('Token still valid');
        }
    }

    /**
     * Refresh tokens (internal use)
     */
    async refreshTokens(): Promise<void> {
        try {
            const tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
            
            if (!tokens || !tokens.refreshToken) {
                throw new Error('No refresh token found');
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
            
            this.homey.settings.set('stellantis_tokens', tokens);
            this.log('Token refreshed successfully');
            
        } catch (error) {
            this.error('Error refreshing token:', error);
        }
    }

    /**
     * Get current valid access token
     * For use by drivers
     */
    async getAccessToken(): Promise<string> {
        const tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        
        if (!tokens) {
            throw new Error('No tokens available. Please configure your account in settings.');
        }
        
        // Check if token needs refresh
        const fiveMinutes = 5 * 60 * 1000;
        if (tokens.expiresAt - Date.now() < fiveMinutes) {
            this.log('Token expired or expiring soon, refreshing...');
            await this.refreshTokens();
            const updatedTokens = this.homey.settings.get('stellantis_tokens') as TokenData;
            return updatedTokens.accessToken;
        }
        
        return tokens.accessToken;
    }

    /**
     * Get Stellantis API client info
     * For use by drivers
     */
    getStellantisClient(): StellantisClient {
        const tokens = this.homey.settings.get('stellantis_tokens') as TokenData | undefined;
        
        if (!tokens) {
            throw new Error('No tokens available');
        }
        
        return {
            brand: tokens.brand,
            country: tokens.country,
            oauth_url: tokens.oauth_url,
            clientid: tokens.client_id,
            getAccessToken: () => this.getAccessToken()
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