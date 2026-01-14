// Data source types
export interface ExchangeIcon {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface Exchange {
  label: string;
  name: string;
  icon: ExchangeIcon;
}

export interface DataSource {
  id: number;
  name: string;
  endpoint: string;
  ticker: string;
  price: string;
  icon: string;
  exchange: Exchange;
  type: string;
}

// Hardcoded trusted data sources
// TODO: Add all remaining data sources from the provided JSON list
// Currently contains a subset - the full list should be added here
export const TRUSTED_DATA_SOURCES: DataSource[] = [
  {
    "id": 12292,
    "name": "Natural Gas",
    "endpoint": "https://api.diadata.org/v1/rwa/Commodities/NG-USD",
    "ticker": "NG",
    "price": "3.169",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Natural-gas-Commodity-logo-1.png",
    "exchange": {
      "label": "Exchange",
      "name": "Commodity",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Commodity.svg",
        "width": 21,
        "height": 20,
        "alt": "Commodity icon (diamond)"
      }
    },
    "type": "Commodity"
  },
  {
    "id": 12288,
    "name": "Crude Oil",
    "endpoint": "https://api.diadata.org/v1/rwa/Commodities/WTI-USD",
    "ticker": "WTI",
    "price": "58.78",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Crude-Oil-WTI-Spot-Commodity-logo-1.png",
    "exchange": {
      "label": "Exchange",
      "name": "Commodity",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Commodity.svg",
        "width": 21,
        "height": 20,
        "alt": "Commodity icon (diamond)"
      }
    },
    "type": "Commodity"
  },
  {
    "id": 12286,
    "name": "Brent Oil",
    "endpoint": "https://api.diadata.org/v1/rwa/Commodities/XBR-USD",
    "ticker": "XBR",
    "price": "63.029999",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Brent-Spot-Commodity-logo-1.png",
    "exchange": {
      "label": "Exchange",
      "name": "Commodity",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Commodity.svg",
        "width": 21,
        "height": 20,
        "alt": "Commodity icon (diamond)"
      }
    },
    "type": "Commodity"
  },
  {
    "id": 12283,
    "name": "Canadian Dollar",
    "endpoint": "https://api.diadata.org/v1/rwa/Fiat/CAD-USD",
    "ticker": "CAD",
    "price": "0.71857664338478",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Canadian-Dollar-FX-Rate-logo.png",
    "exchange": {
      "label": "Region",
      "name": "Canada",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Canadian-Dollar-FX-Rate-logo.png",
        "width": 105,
        "height": 105,
        "alt": "Canadian Dollar FX Rate logo"
      }
    },
    "type": "FX rate"
  },
  {
    "id": 12281,
    "name": "Australian Dollar",
    "endpoint": "https://api.diadata.org/v1/rwa/Fiat/AUD-USD",
    "ticker": "AUD",
    "price": "0.66838664830831",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Australian-Dollar-logo-FX-rate.png",
    "exchange": {
      "label": "Region",
      "name": "Australia",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Australian-Dollar-logo-FX-rate.png",
        "width": 105,
        "height": 105,
        "alt": "Australian Dollar logo FX rate"
      }
    },
    "type": "FX rate"
  },
  {
    "id": 12279,
    "name": "Chinese Yuan",
    "endpoint": "https://api.diadata.org/v1/rwa/Fiat/CNY-USD",
    "ticker": "CNY",
    "price": "0.14322974480756",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Chinese-Yuan-logo-FX.png",
    "exchange": {
      "label": "Region",
      "name": "China",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Chinese-Yuan-logo-FX.png",
        "width": 105,
        "height": 105,
        "alt": "Chinese Yuan logo FX"
      }
    },
    "type": "FX rate"
  },
  {
    "id": 12276,
    "name": "20+ Year Treasury Bond ETF iShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/TLT",
    "ticker": "TLT",
    "price": "87.92",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/20-Year-Treasury-Bond-ETF-iShares-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Nasdaq",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Nasdaq.svg",
        "width": 40,
        "height": 40,
        "alt": "Nasdaq"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12274,
    "name": "1-3 Year Treasury Bond ETF iShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/SHY",
    "ticker": "SHY",
    "price": "82.835",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/1-3-Year-Treasury-Bond-ETF-iShares-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Nasdaq",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Nasdaq.svg",
        "width": 40,
        "height": 40,
        "alt": "Nasdaq"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12272,
    "name": "Short-Term Treasury Fund Vanguard",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/VGSH",
    "ticker": "VGSH",
    "price": "58.74",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Vanguard-Short-Term-Treasury-Fund-ETF-logo-1.png",
    "exchange": {
      "label": "Exchange",
      "name": "Nasdaq",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Nasdaq.svg",
        "width": 40,
        "height": 40,
        "alt": "Nasdaq"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12270,
    "name": "U.S. Treasury Bond ETF iShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/GOVT",
    "ticker": "GOVT",
    "price": "23.055",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/iShares-U.S.-Treasury-Bond-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Bats",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Bats.svg",
        "width": 20,
        "height": 20,
        "alt": "Bats exchange logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12268,
    "name": "Bitcoin & Ether Market Cap Weight ETF ProShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/BETH",
    "ticker": "BETH",
    "price": "52.66",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/ProShares-Bitcoin-Ether-Market-Cap-Weight-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "NYSE",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/NYSE.svg",
        "width": 40,
        "height": 40,
        "alt": "NYSE logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12266,
    "name": "Ethereum Trust ETHA iShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/ETHA",
    "ticker": "ETHA",
    "price": "23.19",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/iShares-Ethereum-Trust-ETHA-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Nasdaq",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Nasdaq.svg",
        "width": 40,
        "height": 40,
        "alt": "Nasdaq"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12264,
    "name": "Bitcoin Strategy ETF ProShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/BITO",
    "ticker": "BITO",
    "price": "12.515",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/ProShares-Bitcoin-Strategy-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "NYSE",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/NYSE.svg",
        "width": 40,
        "height": 40,
        "alt": "NYSE logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12262,
    "name": "Bitcoin Trust (BTC) Grayscale",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/GBTC",
    "ticker": "GBTC",
    "price": "70.475",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Grayscale-Bitcoin-Trust-BTC-ETF-LOGO.png",
    "exchange": {
      "label": "Exchange",
      "name": "NYSE",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/NYSE.svg",
        "width": 40,
        "height": 40,
        "alt": "NYSE logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12260,
    "name": "Bitcoin ETF VanEck",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/HODL",
    "ticker": "HODL",
    "price": "25.52",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/VanEck-Bitcoin-ETF-LOGO.png",
    "exchange": {
      "label": "Exchange",
      "name": "Bats",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Bats.svg",
        "width": 20,
        "height": 20,
        "alt": "Bats exchange logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12258,
    "name": "Bitcoin ETF Ark 21Shares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/ARKB",
    "ticker": "ARKB",
    "price": "29.95",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Ark-21Shares-Bitcoin-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Bats",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Bats.svg",
        "width": 20,
        "height": 20,
        "alt": "Bats exchange logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12255,
    "name": "Bitcoin Index Fund Fidelity Wise Origin",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/FBTC",
    "ticker": "FBTC",
    "price": "78.6",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Fidelity-Wise-Origin-Bitcoin-Index-Fund-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Bats",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/08/Bats.svg",
        "width": 20,
        "height": 20,
        "alt": "Bats exchange logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12251,
    "name": "Bitcoin Trust iShares",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/IBIT",
    "ticker": "IBIT",
    "price": "51.17",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/iShares-Bitcoin-Trust-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Nasdaq",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Nasdaq.svg",
        "width": 40,
        "height": 40,
        "alt": "Nasdaq"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12249,
    "name": "QQQ Trust Invesco",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/QQQ",
    "ticker": "QQQ",
    "price": "626.65997",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Invesco-QQQ-Trust-ETF-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "Nasdaq",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/Nasdaq.svg",
        "width": 40,
        "height": 40,
        "alt": "Nasdaq"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12247,
    "name": "Total Stock Market ETF Vanguard",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/VTI",
    "ticker": "VTI",
    "price": "342.36499",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Vanguard-Total-Stock-Market-ETF-logo-1.png",
    "exchange": {
      "label": "Exchange",
      "name": "NYSE",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/NYSE.svg",
        "width": 40,
        "height": 40,
        "alt": "NYSE logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12245,
    "name": "S&P 500 ETF Trust SPDR",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/SPY",
    "ticker": "SPY",
    "price": "693.98999",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/spdr-sp-500-etf-trust-logo.png",
    "exchange": {
      "label": "Exchange",
      "name": "NYSE",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/NYSE.svg",
        "width": 40,
        "height": 40,
        "alt": "NYSE logo"
      }
    },
    "type": "ETF"
  },
  {
    "id": 12243,
    "name": "S&P 500 ETF Vanguard",
    "endpoint": "https://api.diadata.org/v1/rwa/ETF/VOO",
    "ticker": "VOO",
    "price": "638.25",
    "icon": "https://cms3.diadata.org/wp-content/uploads/2025/08/Vanguard-SP-500-ETF-Vanguard.png",
    "exchange": {
      "label": "Exchange",
      "name": "NYSE",
      "icon": {
        "url": "https://cms3.diadata.org/wp-content/uploads/2025/02/NYSE.svg",
        "width": 40,
        "height": 40,
        "alt": "NYSE logo"
      }
    },
    "type": "ETF"
  }
];

/**
 * Get all trusted data sources
 */
export function getAllDataSources(): DataSource[] {
  return TRUSTED_DATA_SOURCES;
}

/**
 * Get data source by ID
 */
export function getDataSourceById(id: number): DataSource | undefined {
  return TRUSTED_DATA_SOURCES.find(ds => ds.id === id);
}

/**
 * Get data sources by type
 */
export function getDataSourcesByType(type: string): DataSource[] {
  return TRUSTED_DATA_SOURCES.filter(ds => ds.type === type);
}

/**
 * Get data source by ticker
 */
export function getDataSourceByTicker(ticker: string): DataSource | undefined {
  return TRUSTED_DATA_SOURCES.find(ds => ds.ticker === ticker);
}

/**
 * Exchange rate response from API Ninjas
 */
export interface ExchangeRateResponse {
  currency_pair: string;
  exchange_rate: number;
}

export interface ApiErrorResponse {
  error: string;
}

/**
 * Supported currencies for exchange rate API (free tier)
 * These currencies can be paired with USD
 */
export const SUPPORTED_EXCHANGE_RATE_CURRENCIES = {
  USD: { name: 'US Dollar', symbol: 'USD' },
  CNY: { name: 'Chinese Yuan', symbol: 'CNY' },
  CHF: { name: 'Swiss Franc', symbol: 'CHF' },
  AUD: { name: 'Australian Dollar', symbol: 'AUD' },
  PLN: { name: 'Polish Zloty', symbol: 'PLN' },
  TRY: { name: 'Turkish New Lira', symbol: 'TRY' },
  GBP: { name: 'British Pound', symbol: 'GBP' },
  NZD: { name: 'New Zealand Dollar', symbol: 'NZD' },
  KRW: { name: 'South Korean Won', symbol: 'KRW' },
  DKK: { name: 'Danish Krone', symbol: 'DKK' },
  HKD: { name: 'Hong Kong Dollar', symbol: 'HKD' },
} as const;

/**
 * Check if a currency is supported for exchange rate API
 */
export function isSupportedCurrency(currency: string): boolean {
  return currency.toUpperCase() in SUPPORTED_EXCHANGE_RATE_CURRENCIES;
}

/**
 * Validate currency pair for exchange rate API
 * Returns error message if invalid, null if valid
 */
export function validateCurrencyPair(from: string, to: string): string | null {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();
  
  if (!isSupportedCurrency(fromUpper)) {
    return `Currency "${fromUpper}" is not supported. Supported currencies: ${Object.keys(SUPPORTED_EXCHANGE_RATE_CURRENCIES).join(', ')}`;
  }
  
  if (!isSupportedCurrency(toUpper)) {
    return `Currency "${toUpper}" is not supported. Supported currencies: ${Object.keys(SUPPORTED_EXCHANGE_RATE_CURRENCIES).join(', ')}`;
  }
  
  return null;
}

// Default API Ninjas key
const DEFAULT_API_NINJAS_KEY = 'P5ALi2n0tLAExP6OzAB5yVydHCCeC3v0LKDmRDSA';

/**
 * Fetch exchange rate from API Ninjas for any currency pair
 * @param pair - Currency pair in format "CURRENCY1_CURRENCY2" (e.g., "USD_EUR", "GBP_AUD")
 * @param apiKey - API Ninjas API key (optional, uses default or API_NINJAS_KEY env var)
 * @returns Exchange rate data or null if error
 */
export async function fetchExchangeRate(
  pair: string,
  apiKey?: string
): Promise<ExchangeRateResponse | null> {
  const key = apiKey || process.env.API_NINJAS_KEY || DEFAULT_API_NINJAS_KEY;
  
  // Validate currency pair format
  const parts = pair.split('_');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(`Invalid currency pair format: ${pair}. Expected format: CURRENCY1_CURRENCY2`);
    return null;
  }
  
  const validationError = validateCurrencyPair(parts[0], parts[1]);
  if (validationError) {
    console.error(validationError);
    return null;
  }

  try {
    const response = await fetch(
      `https://api.api-ninjas.com/v1/exchangerate?pair=${encodeURIComponent(pair)}`,
      {
        headers: {
          'X-Api-Key': key,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Ninjas exchange rate request failed: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText) as ApiErrorResponse;
        if (errorJson.error) {
          errorMessage = errorJson.error;
          console.error(`API Ninjas Error: ${errorMessage}`);
        }
      } catch {
        // If not JSON, use the text as is
        errorMessage = errorText || errorMessage;
        console.error(errorMessage);
      }
      return null;
    }

    const data = await response.json() as ExchangeRateResponse;
    return data;
  } catch (error) {
    console.error('Error fetching exchange rate from API Ninjas:', error);
    return null;
  }
}

/**
 * Get exchange rate for a currency pair (wrapper that handles common formats)
 * @param from - Source currency (e.g., "USD", "GBP")
 * @param to - Target currency (e.g., "GBP", "AUD")
 * @param apiKey - Optional API key (uses default if not provided)
 * @returns Exchange rate data or null
 */
export async function getExchangeRate(
  from: string,
  to: string,
  apiKey?: string
): Promise<ExchangeRateResponse | null> {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();
  const validationError = validateCurrencyPair(fromUpper, toUpper);
  if (validationError) {
    console.error(validationError);
    return null;
  }
  
  const pair = `${fromUpper}_${toUpper}`;
  return fetchExchangeRate(pair, apiKey);
}

/**
 * Income tax response from API Ninjas
 */
export interface IncomeTaxResponse {
  country: string;
  year: string | number;
  federal?: {
    single?: {
      brackets?: Array<{
        rate: number;
        min: number;
        max: number | string;
      }>;
    };
    married_joint?: {
      brackets?: Array<{
        rate: number;
        min: number;
        max: number | string;
      }>;
    };
    married_separate?: {
      brackets?: Array<{
        rate: number;
        min: number;
        max: number | string;
      }>;
    };
    head_of_household?: {
      brackets?: Array<{
        rate: number;
        min: number;
        max: number | string;
      }>;
    };
  };
  fica?: {
    social_security?: {
      rate: number;
      wage_base: number;
    };
    medicare?: {
      rate: number;
      additional_rate?: number;
      threshold?: number;
    };
  } | string;
  states?: Array<{
    code: string;
    name: string;
    brackets?: Array<{
      rate: number;
      min: number;
      max: number | string;
    }>;
  }> | string;
  provinces?: Array<{
    code: string;
    name: string;
    brackets?: Array<{
      rate: number;
      min: number;
      max: number | string;
    }>;
  }> | string;
}

/**
 * Fetch income tax information from API Ninjas
 * @param country - 2-letter country code (e.g., "US", "CA")
 * @param year - Tax year (e.g., 2024)
 * @param options - Optional parameters
 * @param options.region - 2-letter state/province code (e.g., "AL", "ON", "BC")
 * @param options.federalOnly - If true, returns only federal tax information
 * @param options.apiKey - API key (optional, uses default or API_NINJAS_KEY env var)
 * @returns Income tax data or null if error
 */
export async function fetchIncomeTax(
  country: string,
  year: number,
  options?: {
    region?: string;
    federalOnly?: boolean;
    apiKey?: string;
  }
): Promise<IncomeTaxResponse | null> {
  const apiKey = options?.apiKey || process.env.API_NINJAS_KEY || DEFAULT_API_NINJAS_KEY;

  try {
    const params = new URLSearchParams({
      country: country.toUpperCase(),
      year: year.toString(),
    });

    if (options?.region) {
      params.append('region', options.region.toUpperCase());
    }

    if (options?.federalOnly === true) {
      params.append('federal_only', 'true');
    }

    const response = await fetch(
      `https://api.api-ninjas.com/v1/incometax?${params.toString()}`,
      {
        headers: {
          'X-Api-Key': apiKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Ninjas income tax request failed: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText) as ApiErrorResponse;
        if (errorJson.error) {
          errorMessage = errorJson.error;
          console.error(`API Ninjas Error: ${errorMessage}`);
        }
      } catch {
        // If not JSON, use the text as is
        errorMessage = errorText || errorMessage;
        console.error(errorMessage);
      }
      return null;
    }

    const data = await response.json() as IncomeTaxResponse;
    return data;
  } catch (error) {
    console.error('Error fetching income tax from API Ninjas:', error);
    return null;
  }
}

/**
 * Non-premium countries available for inflation data (CPI and/or HICP)
 */
export const NON_PREMIUM_INFLATION_COUNTRIES = {
  // Countries with both CPI and HICP (non-premium)
  AT: { name: 'Austria', cpi: true, hicp: true },
  BE: { name: 'Belgium', cpi: true, hicp: true },
  EE: { name: 'Estonia', cpi: true, hicp: true },
  DE: { name: 'Germany', cpi: true, hicp: true },
  HU: { name: 'Hungary', cpi: true, hicp: true },
  IS: { name: 'Iceland', cpi: true, hicp: true },
  IE: { name: 'Ireland', cpi: true, hicp: true },
  PT: { name: 'Portugal', cpi: true, hicp: true },
  SK: { name: 'Slovakia', cpi: true, hicp: true },
  SE: { name: 'Sweden', cpi: true, hicp: true },
  // Countries with only CPI (non-premium)
  CA: { name: 'Canada', cpi: true, hicp: false },
  CL: { name: 'Chile', cpi: true, hicp: false },
  MX: { name: 'Mexico', cpi: true, hicp: false },
  NO: { name: 'Norway', cpi: true, hicp: false },
  RU: { name: 'Russia', cpi: true, hicp: false },
  CH: { name: 'Switzerland', cpi: true, hicp: false },
  // Netherlands has CPI (non-premium) but HICP is premium
  NL: { name: 'The Netherlands', cpi: true, hicp: false },
} as const;

/**
 * Inflation response from API Ninjas
 */
export interface InflationResponse {
  country: string;
  country_code: string;
  type: 'CPI' | 'HICP';
  period: string;
  monthly_rate_pct: number;
  yearly_rate_pct: number;
}

/**
 * Fetch inflation data from API Ninjas
 * @param country - 2-letter country code (e.g., "US", "DE") or country name
 * @param options - Optional parameters
 * @param options.type - Inflation indicator type: "CPI" or "HICP" (default: "CPI")
 * @param options.apiKey - API key (optional, uses default or API_NINJAS_KEY env var)
 * @returns Inflation data or null if error
 */
export async function fetchInflation(
  country: string,
  options?: {
    type?: 'CPI' | 'HICP';
    apiKey?: string;
  }
): Promise<InflationResponse | null> {
  const apiKey = options?.apiKey || process.env.API_NINJAS_KEY || DEFAULT_API_NINJAS_KEY;

  try {
    const params = new URLSearchParams({
      country: country,
    });

    if (options?.type) {
      params.append('type', options.type);
    }

    const response = await fetch(
      `https://api.api-ninjas.com/v1/inflation?${params.toString()}`,
      {
        headers: {
          'X-Api-Key': apiKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Ninjas inflation request failed: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText) as ApiErrorResponse;
        if (errorJson.error) {
          errorMessage = errorJson.error;
          console.error(`API Ninjas Error: ${errorMessage}`);
        }
      } catch {
        // If not JSON, use the text as is
        errorMessage = errorText || errorMessage;
        console.error(errorMessage);
      }
      return null;
    }

    const data = await response.json() as InflationResponse;
    return data;
  } catch (error) {
    console.error('Error fetching inflation from API Ninjas:', error);
    return null;
  }
}


