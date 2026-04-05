export type { IDataProvider, WeatherData, NewsItem, WeatherProviderConfig, NewsProviderConfig } from './interface.js';
export { openWeatherMapProvider } from './openWeatherMap.js';
export { newsApiProvider } from './newsApi.js';
export { ddgWeatherSearch, ddgNewsSearch, cityFromTimezone } from './duckDuckGo.js';
