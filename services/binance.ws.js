
const axios = require('axios');
const CISDIndicator =require('./Indicator.js')
const SignalModel = require('../models/Signal');
const CandleModel = require('../models/Candle.js')
const {upsertCandle,mapCandle,trimOldCandles} = require('./tradeHelper.js')
// Store historical OHLC data for indicator calculation
const ohlcBuffer = [];
const MAX_BUFFER_SIZE = 500;

// Store active trades for monitoring
const activeTrades = new Map();

// Initialize indicator
const Indicator = new CISDIndicator({
  tolerance: 0.65,
  swingPeriod: 6,       // faster structure
  expiryBars: 50,       // only recent liquidity
  liquidityLookback: 5 // recent sweep only
});

let pollingInterval = null;
let lastCandleTime = null;

const find_trade_details = async()=>{

   const candles = await CandleModel
  .find({ symbol: "BTCUSDT", timeframe: "1m" })
  .sort({ openTime: 1 })     // IMPORTANT: oldest → newest
  .limit(50);
const ohlcData = candles.map(c => ({
  timestamp: c.openTime,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close
}));
const results = Indicator.calculate(ohlcData);

// Last candle = current signal
const last = results[results.length - 1];

if (last.bullishSweep) {
  console.log("🟢 STRONG BUY SETUP");
}

if (last.bearishSweep) {
  console.log("🔴 STRONG SELL SETUP");
}

if (last.cisd === 1) {
  console.log("Bullish CISD detected at", last.cisdLevel);
}

if (last.cisd === -1) {
  console.log("Bearish CISD detected at", last.cisdLevel);
}


}
// Fetch from Binance.US API
const fetchFromBinanceUS = async () => {
  const response = await axios.get("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1", {
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
        const signal = await find_trade_details();
        console.log(signal,'working-----')

        // if(signal.signal != "NEUTRAL"){
        //     const details = {
        //       signal: signal.signal,
        //       strength: signal.strength,
        //       confidence: signal.confidence,
        //       price: signal.price,
        //       signalTime: new Date(),
        //       cisd: signal.details.cisd,
        //       cisdLevel: signal.details.cisdLevel,
        //       trend: signal.details.trend,
        //       bullishSweep: signal.details.bullishSweep,
        //       bearishSweep: signal.details.bearishSweep,
        //       swingHigh: signal.details.swingHigh,
        //       swingLow: signal.details.swingLow    
        //     }

        //   await SignalModel.updateOne(
        //     { price: signal.price, signal: signal.signal },
        //     { $setOnInsert: details },
        //     { upsert: true }
        //   );
        // }
        
    } catch (error) {
        console.error('❌ Analysis error:', error.message);
    }
}

async function getActiveAPI() {
  const requests = [
    fetchFromBinanceUS(),
    fetchFromCryptoCompare(),
    fetchFromCoinGecko()
  ];

  // Returns FIRST successful response, ignores failures
  return Promise.any(requests);
}

let lastSavedOpenTime = null;



const connectBinance = async () => {
  console.log('entering to fetch----------------------------------------')
  const res = await fetch("https://public.coindcx.com/market_data/candles?pair=B-BTC_USDT&interval=1m");
  const data = await res.json();
console.log(data,'--------------------------------')   
// Extract OHLC
const [open, high, low, close] = [data[0][1], data[0][2], data[0][3], data[0][4]];
// Save or emit webhook
console.log(open,":open", high,":high", low,":low", close,":close" )
}

// const connectBinance = async () => {
//   const { closed, current } = await fetchFromBinanceUS();
   
  
//   if (closed[0] === lastSavedOpenTime) return;


//   const open_de = {
//     open: +closed[1],
//     high: +closed[2],
//     low: +closed[3],
//     close: +closed[4],
//   }

//   const close_de = {
//     open: +current[1],
//     high: +current[2],
//     low: +current[3],
//     close: +current[4],
//   }


// console.log(open_de,':closed',close_de,':current')
//   lastSavedOpenTime = closed[0];

//   const candle = {
//     symbol: "BTCUSDT",
//     timeframe: "1m",
//     openTime: Number(closed[0]),
//     open: +closed[1],
//     high: +closed[2],
//     low: +closed[3],
//     close: +closed[4],
//     volume: +closed[5],
//     closeTime: Number(closed[6])
//   };

//   await upsertCandle(candle);
//   await trimOldCandles("BTCUSDT", "1m", 50);
//   await analyzeMarket();



// };


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


