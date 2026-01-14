# Bun.ts Server Integration Guide

This document outlines the primary administrative controls available for the frontend to trigger system actions.

## 🔗 Base URL
- **Development:** `http://localhost:3000`

---

## 🛠 Administrative Controls

These are the primary actions used by the frontend to control the simulation.

### 1. Generate Proposals
This endpoint triggers the LLM to generate 5 new market proposals, register them on-chain, and initialize their AMM pools.
- **Endpoint:** `POST /api/init/proposals`
- **Action:** Triggers the generation of 5 new LLM-driven market proposals.

### 2. Initialize Agents
This endpoint generates AI agents with unique personalities and registers their wallets on-chain.
- **Endpoint:** `POST /api/init/agents`
- **Action:** Initializes AI agents with distinct trading personalities.

### 3. Start Trading
This endpoint starts the automated trading loop where AI agents analyze the markets and execute swaps.
- **Endpoint:** `POST /api/trade/start`
- **Action:** Starts the automated 15-minute trading round loop.

---

## 📊 Monitoring & History

To verify the results of the administrative actions and view winning proposals (History), use the following polling endpoints:

### 1. Market State
- **Endpoint:** `GET /api/market`
- **Action:** Returns the current active proposals and AMM prices.

### 2. Graduated Proposals (History)
- **Endpoint:** `GET /api/history` (or `GET /api/graduated`)
- **Action:** Returns an array of all proposals that have won a round and graduated.

### 3. Agent Status
- **Endpoint:** `GET /api/agents`
- **Action:** Returns current agent balances and their trade history.

### 4. System Logs
- **Endpoint:** `GET /api/logs`
- **Action:** Returns detailed system execution logs.

---

## 🛠 Data Schema: Market Strategy

This schema applies to both active proposals in `/api/market` and graduated proposals in `/api/history`.

```typescript
interface MarketStrategy {
  id: string;               // Unique ID (e.g., strategy-1-17368817...)
  name: string;             // Human-readable title
  description: string;      // The actual prediction target
  evaluationLogic: string;  // Human-friendly verification logic
  mathematicalLogic: string;// Machine-friendly verification logic
  resolutionDeadline: number; // UTC Timestamp (ms)
  resolved: boolean;        // Whether the round is finished
  winner: 'yes' | 'no' | null; // The outcome
  timestamp: number;        // When the strategy was created
  yesToken: {
    tokenReserve: number;   // AMM Reserve
    twap: number;           // The winning metric (Time Weighted Avg Price)
    history: Array<{ price: number; timestamp: number }>;
  };
  noToken: {
    tokenReserve: number;
    twap: number;
    history: Array<{ price: number; timestamp: number }>;
  };
}
```
