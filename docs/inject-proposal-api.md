# `/api/proposal/inject` - Inject Custom Proposals

## Overview

This endpoint allows users to inject custom proposals into the prediction market **after** AI agents have generated their base proposals, but **before** trading starts.

## Prerequisites

1. ✅ AI proposals must be generated first via `/api/admin/init` or `/api/init/proposals`
2. ✅ Trading must not be active (`/api/trade/start` not called yet)

## Endpoint

```
POST /api/proposal/inject
Content-Type: application/json
```

## Request Body

The injected proposal must have **exactly the same structure** as AI-generated proposals:

```json
{
  "name": "iShares Bitcoin Trust breaks $60",
  "description": "iShares Bitcoin Trust (IBIT) price will exceed $60 by March 2026",
  "evaluationLogic": "IBIT > 60",
  "mathematicalLogic": "price > 60",
  "usedDataSources": [
    {
      "id": 12251,
      "currentValue": 51.17,
      "targetValue": 60,
      "operator": ">"
    }
  ],
  "resolutionDeadline": 1740787200000,
  "initialLiquidity": 2000
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Short, clear name of the proposal |
| `description` | string | Detailed description of the prediction |
| `evaluationLogic` | string | Human-readable logic (e.g., "BTC > 100000") |
| `mathematicalLogic` | string | Machine-readable formula (e.g., "price > 100000") |
| `usedDataSources` | array | **Must be non-empty** array of data source objects |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `resolutionDeadline` | number | +30 days | Unix timestamp (ms) |
| `initialLiquidity` | number | 2000 | Initial liquidity in vUSDC |

### `usedDataSources` Structure

Each data source object **must** have these fields:

```typescript
{
  id: number;           // Data source ID (e.g., 12254 for BTC)
  currentValue: number; // Current value from data source
  targetValue: number;  // Target value for the prediction
  operator: string;     // Comparison operator: ">", ">=", "<", "<=", "=="
}
```

**Note:** This structure is **identical** to AI-generated proposals.

## Common Data Source IDs

| Asset | ID | Description |
|-------|-------|-------------|
| SPY | 12245 | S&P 500 ETF |
| QQQ | 12249 | Nasdaq 100 ETF |
| IBIT | 12251 | iShares Bitcoin Trust |
| FBTC | 12255 | Fidelity Bitcoin Fund |
| GBTC | 12262 | Grayscale Bitcoin Trust |
| WTI | 12288 | Crude Oil (WTI) |
| NG | 12292 | Natural Gas |

*(For complete list, see data sources in `/src/llm/dataSources.ts`)*

## Example Usage

### Step 1: Initialize Market
```bash
curl -X POST http://localhost:3000/api/admin/init
```

### Step 2: Inject Custom Proposal
```bash
curl -X POST http://localhost:3000/api/proposal/inject \
  -H "Content-Type: application/json" \
  -d '{
    "name": "S&P 500 reaches $750",
    "description": "S&P 500 ETF (SPY) price exceeds $750 by June 2026",
    "evaluationLogic": "SPY > 750",
    "mathematicalLogic": "price > 750",
    "usedDataSources": [
      {
        "id": 12245,
        "currentValue": 693.99,
        "targetValue": 750,
        "operator": ">"
      }
    ],
    "resolutionDeadline": 1748736000000,
    "initialLiquidity": 3000
  }'
```

### Step 3: Start Trading
```bash
curl -X POST http://localhost:3000/api/trade/start
```

## Success Response

```json
{
  "success": true,
  "message": "Proposal injected successfully",
  "proposal": {
    "id": "custom-1736956789123-abc123",
    "name": "S&P 500 reaches $750",
    "yesToken": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "poolId": "0x...",
    "txHash": "0x4b2e138f7460ec31ce011114d0b6537bea49611e9d2a0f8cca2ca8dce9393ca5"
  }
}
```

## Error Responses

### No AI Proposals Generated Yet
```json
{
  "success": false,
  "error": "Cannot inject proposals before AI agents generate their proposals. Call /api/admin/init or /api/init/proposals first."
}
```

### Trading Already Started
```json
{
  "success": false,
  "error": "Cannot inject proposals while trading is active"
}
```

### Missing Required Fields
```json
{
  "success": false,
  "error": "Missing required fields: name, description, evaluationLogic, mathematicalLogic"
}
```

### Invalid usedDataSources
```json
{
  "success": false,
  "error": "usedDataSources must be a non-empty array with data source objects"
}
```

### Invalid Data Source Structure
```json
{
  "success": false,
  "error": "Each usedDataSource must have: id (number), currentValue (number), targetValue (number), operator (string)"
}
```

## Notes

- Injected proposals are created **on-chain** and added to **in-memory** market state
- The proposal structure is **identical** to AI-generated proposals
- Multiple custom proposals can be injected before trading starts
- Once trading starts, no more proposals can be added

