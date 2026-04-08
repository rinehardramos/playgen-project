import { InfoBrokerClient } from '@playgen/info-broker-client';
import { config } from '../config.js';

let _client: InfoBrokerClient | null = null;

/**
 * Returns a singleton InfoBrokerClient.
 * Returns null if INFO_BROKER_BASE_URL is not configured — caller should
 * skip broker-dependent segment types gracefully.
 */
export function getInfoBrokerClient(): InfoBrokerClient | null {
  if (!config.infoBroker.baseUrl) {
    return null;
  }
  if (!_client) {
    _client = new InfoBrokerClient({
      baseUrl: config.infoBroker.baseUrl,
      apiKey: config.infoBroker.apiKey,
      timeoutMs: config.infoBroker.timeoutMs,
    });
  }
  return _client;
}

/** Reset singleton (used in tests). */
export function _resetInfoBrokerClient(): void {
  _client = null;
}
