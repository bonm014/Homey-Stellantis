/**
 * Stellantis API - TypeScript Module
 * 
 * Node.js/TypeScript module for communicating with the Stellantis/PSA API
 * Supports: Peugeot, Citroën, DS, Opel, Vauxhall
 */

export { StellantisClient } from './client';
export { StellantisRemoteClient } from './remote';

export * from './types';

// Default export
export { StellantisClient as default } from './client';
