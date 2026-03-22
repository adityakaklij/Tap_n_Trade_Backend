# tapTrading backend

Node.js + MongoDB backend for TapTrading.

## Requirements

- Node.js 20+
- MongoDB

## Setup

Create `.env`:

```bash
MONGODB_URI="mongodb://127.0.0.1:27017/taptrading"
PORT=8080
BINANCE_WS_BASE="wss://stream.binance.com:9443/ws"
```

Install and run:

```bash
npm install
npm run dev
```

## Websocket

- URL: `ws://localhost:8080/ws`
- Default subscription: all token pairs

Client can optionally scope by token pair:

```json
{ "type": "subscribe", "tokenPairId": "..." }
```

## REST base URL

`http://localhost:8080/api`

# Tap_n_Trade_Backend
