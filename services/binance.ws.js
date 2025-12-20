
const axios = require('axios');
const CISDSignalService = require('../services/CICDsignalService');
const Trade = require('../models/Trade');
const SignalModel = require('../models/Signal');
const {upsertCandle,mapCandle,trimOldCandles} = require('./tradeHelper.js')
// Store historical OHLC data for indicator calculation
const ohlcBuffer = [];
const MAX_BUFFER_SIZE = 500;

// Store active trades for monitoring
const activeTrades = new Map();

// Initialize indicator
const service = new CISDSignalService({
            symbol: 'BTCUSDT',
            timeframe: '1m',
            tolerance: 0.7,
            swingPeriod: 12,
            expiryBars: 100,
            liquidityLookback: 10
        });

let pollingInterval = null;
let lastCandleTime = null;


// Fetch from Binance.US API
const fetchFromBinanceUS = async () => {
  const response = await axios.get("https://api.binance.us/api/v3/klines", {
    params: {
      symbol: 'BTCUSDT',
      interval: '1m',
      limit: 2
    },
    timeout: 10000
  });
  
  return {
    closed: response.data[0],
    current: response.data[1]
  };
};


async function analyzeMarket() {
    try {
        const signal = await service.getFormattedSignal();
        console.log(signal,'working-----')

        if(signal.signal != "NEUTRAL"){
            const details = {
              signal: signal.signal,
              strength: signal.strength,
              confidence: signal.confidence,
              price: signal.price,
              signalTime: new Date(),
              cisd: signal.details.cisd,
              cisdLevel: signal.details.cisdLevel,
              trend: signal.details.trend,
              bullishSweep: signal.details.bullishSweep,
              bearishSweep: signal.details.bearishSweep,
              swingHigh: signal.details.swingHigh,
              swingLow: signal.details.swingLow    
            }

          await SignalModel.updateOne(
            { price: signal.price, signal: signal.signal },
            { $setOnInsert: details },
            { upsert: true }
          );
        }
        
    } catch (error) {
        console.error('❌ Analysis error:', error.message);
    }
}

async function getActiveAPI() {
  const requests = [
    fetchFromBinanceUS(),
    // fetchFromCryptoCompare(),
    // fetchFromCoinGecko()
  ];

  // Returns FIRST successful response, ignores failures
  return Promise.any(requests);
}

const connectBinance = async (io) => {
  try {
    const response = await getActiveAPI();
    const {current,closed} = response;
    
     const closed_details = {
      symbol: "BTCUSDT",
      timeframe: "1m",
      openTime: Number(closed[0]),
      closeTime: Number(closed[6]),
      open: parseFloat(closed[1]),
      high: parseFloat(closed[2]),
      low: parseFloat(closed[3]),
      close: parseFloat(closed[4]),
      volume: parseFloat(closed[5])
     }

    if(response){
      await upsertCandle(closed_details)
      await trimOldCandles(closed_details.symbol,closed_details.timeframe,50)
      await analyzeMarket();
      io.emit('binance_price',Number(current[4]))
    }
  } catch (err) {
    console.error("❌ All APIs failed",err.message);
  }
};

const disconnectBinance = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log("❌ Polling stopped");
  }
};

const getBufferStatus = () => {
  return {
    size: ohlcBuffer.length,
    minRequired: indicator.len * 2 + 10,
    ready: ohlcBuffer.length >= indicator.len * 2 + 10,
    firstCandle: ohlcBuffer[0]?.timestamp || null,
    lastCandle: ohlcBuffer[ohlcBuffer.length - 1]?.timestamp || null,
    lastCandleTime: lastCandleTime,
    isPolling: pollingInterval !== null
  };
};

const calculateIndicator = () => {
  if (ohlcBuffer.length < indicator.len * 2 + 10) {
    return { error: 'Not enough data', bufferStatus: getBufferStatus() };
  }
  
  const results = indicator.calculate(ohlcBuffer);
  return results;
};

module.exports = { 
  connectBinance,
  disconnectBinance,
  getBufferStatus, 
  calculateIndicator,
  ohlcBuffer,
  activeTrades,
};


