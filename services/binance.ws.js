
const axios = require('axios');
const CISDIndicator = require('../services/Indicator');
const Trade = require('../models/Trade');

// Store historical OHLC data for indicator calculation
const ohlcBuffer = [];
const MAX_BUFFER_SIZE = 500;

// Store active trades for monitoring
const activeTrades = new Map();

// Initialize indicator
const indicator = new CISDIndicator({
    tolerance: 0.7,
    swingPeriod: 12,
    expiryBars: 100,
    liquidityLookback: 10
});

let pollingInterval = null;
let lastCandleTime = null;

// Multiple API endpoints to try (fallback strategy)
const API_ENDPOINTS = [
  // Option 1: Try Binance.US first
  "https://api.binance.us/api/v3/klines",
  
  // Option 2: Use CoinGecko API (free, no restrictions)
  // Note: Different response format, needs adapter
  "https://api.coingecko.com/api/v3/coins/bitcoin/ohlc",
  
  // Option 3: CryptoCompare API (free tier available)
  "https://min-api.cryptocompare.com/data/v2/histominute",
  
  // Option 4: Your own proxy (if you set one up)
  process.env.BINANCE_PROXY_URL
].filter(Boolean); // Remove null/undefined values

let currentEndpointIndex = 0;

// Helper function to create a trade
const createTrade = async (signal, price, symbol) => {
  try {
    const direction = signal.bullishSweep ? 'BUY' : 'SELL';
    const entryPrice = price;
    const stopLoss = direction === 'BUY' 
      ? entryPrice * (1 - 0.008)
      : entryPrice * (1 + 0.008);
    
    const target = direction === 'BUY'
      ? entryPrice * (1 + 0.012)
      : entryPrice * (1 - 0.012);
    
    const tradedQuantity = 50;

    const trade = new Trade({
      name: `${symbol} ${direction} Signal`,
      entryPrice: entryPrice,
      direction: direction,
      stopLoss: stopLoss,
      target: target,
      tradedQuantity: tradedQuantity,
      currentStatus: 'PENDING',
      tradeStatus: 'OPEN',
      symbol: symbol,
      signalType: signal.bullishSweep ? 'STRONG_BULLISH' : 'STRONG_BEARISH',
      entryTime: new Date()
    });

    await trade.save();
    activeTrades.set(trade._id.toString(), trade);
    
    console.log(`✅ Trade Created: ${direction} ${symbol} at ${entryPrice.toFixed(2)}`);
    console.log(`   SL: ${stopLoss.toFixed(2)} | Target: ${target.toFixed(2)}`);
    
    return trade;
  } catch (error) {
    console.error('Error creating trade:', error.message);
    return null;
  }
};

// Helper function to check and update active trades
const checkActiveTrades = async (currentPrice) => {
  for (const [tradeId, trade] of activeTrades.entries()) {
    try {
      let shouldUpdate = false;
      let newStatus = 'PENDING';
      let tradeResult = 'OPEN';

      if (trade.direction === 'BUY') {
        if (currentPrice >= trade.target) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'WINNER';
          console.log(`🎯 Target Hit! Trade #${tradeId} - WINNER`);
        }
        else if (currentPrice <= trade.stopLoss) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'LOSER';
          console.log(`🛑 Stop Loss Hit! Trade #${tradeId} - LOSER`);
        }
      } else if (trade.direction === 'SELL') {
        if (currentPrice <= trade.target) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'WINNER';
          console.log(`🎯 Target Hit! Trade #${tradeId} - WINNER`);
        }
        else if (currentPrice >= trade.stopLoss) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'LOSER';
          console.log(`🛑 Stop Loss Hit! Trade #${tradeId} - LOSER`);
        }
      }

      if (shouldUpdate) {
        await Trade.findByIdAndUpdate(tradeId, {
          currentStatus: newStatus,
          tradeStatus: tradeResult,
          exitPrice: currentPrice,
          exitTime: new Date(),
          profitLoss: trade.direction === 'BUY' 
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100
        });
        
        activeTrades.delete(tradeId);
      }
    } catch (error) {
      console.error(`Error updating trade ${tradeId}:`, error.message);
    }
  }
};

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

// Fetch from CryptoCompare API (alternative)
const fetchFromCryptoCompare = async () => {
  const response = await axios.get("https://min-api.cryptocompare.com/data/v2/histominute", {
    params: {
      fsym: 'BTC',
      tsym: 'USDT',
      limit: 2
    },
    timeout: 10000
  });
  
  const data = response.data.Data.Data;
  const closed = data[data.length - 2]; // Previous candle
  const current = data[data.length - 1]; // Current candle
  
  // Convert to Binance format
  return {
    closed: [
      closed.time * 1000,
      closed.open.toString(),
      closed.high.toString(),
      closed.low.toString(),
      closed.close.toString(),
      closed.volumeto.toString(),
      closed.time * 1000
    ],
    current: [
      current.time * 1000,
      current.open.toString(),
      current.high.toString(),
      current.low.toString(),
      current.close.toString(),
      current.volumeto.toString(),
      current.time * 1000
    ]
  };
};

// Fetch from CoinGecko (alternative)
const fetchFromCoinGecko = async () => {
  // CoinGecko uses different structure, need to get current price separately
  const priceResponse = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
    params: {
      ids: 'bitcoin',
      vs_currencies: 'usd'
    },
    timeout: 10000
  });
  
  const ohlcResponse = await axios.get("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc", {
    params: {
      vs_currency: 'usd',
      days: 1
    },
    timeout: 10000
  });
  
  const data = ohlcResponse.data;
  const lastCandle = data[data.length - 2]; // Previous candle
  const currentPrice = priceResponse.data.bitcoin.usd;
  
  return {
    closed: [
      lastCandle[0],
      lastCandle[1].toString(),
      lastCandle[2].toString(),
      lastCandle[3].toString(),
      lastCandle[4].toString(),
      '0',
      lastCandle[0]
    ],
    current: [
      Date.now(),
      currentPrice.toString(),
      currentPrice.toString(),
      currentPrice.toString(),
      currentPrice.toString(),
      '0',
      Date.now()
    ]
  };
};

// Main fetch function with fallback
const fetchBinanceData = async (io) => {
  try {
    let data;
    let apiUsed = 'unknown';
    
    // Try Binance.US first
    try {
      data = await fetchFromBinanceUS();
      apiUsed = 'Binance.US';
      console.log('✅ Using Binance.US API');
    } catch (error) {
      if (error.response?.status === 451) {
        console.log('⚠️  Binance.US blocked, trying alternatives...');
      }
      
      // Try CryptoCompare
      try {
        data = await fetchFromCryptoCompare();
        apiUsed = 'CryptoCompare';
        console.log('✅ Using CryptoCompare API');
      } catch (error2) {
        console.log('⚠️  CryptoCompare failed, trying CoinGecko...');
        
        // Try CoinGecko as last resort
        data = await fetchFromCoinGecko();
        apiUsed = 'CoinGecko';
        console.log('✅ Using CoinGecko API');
      }
    }

    if (!data || !data.closed) {
      console.error('No data received from any API');
      return;
    }

    const klineData = data.closed;
    const currentKline = data.current;
    
    const candleCloseTime = klineData[6];
    
    // Only process if this is a new candle
    if (lastCandleTime === candleCloseTime) {
      const currentPrice = parseFloat(currentKline[4]);
      await checkActiveTrades(currentPrice);
      
      io.emit("binance_kline", {
        symbol: 'BTCUSDT',
        open: parseFloat(currentKline[1]),
        high: parseFloat(currentKline[2]),
        low: parseFloat(currentKline[3]),
        close: currentPrice,
        volume: parseFloat(currentKline[5]),
        isClosed: false,
        time: currentKline[0],
        indicator: null,
        bufferSize: ohlcBuffer.length,
        activeTrades: activeTrades.size,
        apiSource: apiUsed
      });
      return;
    }
    
    lastCandleTime = candleCloseTime;

    const ohlcCandle = {
      timestamp: klineData[0],
      open: parseFloat(klineData[1]),
      high: parseFloat(klineData[2]),
      low: parseFloat(klineData[3]),
      close: parseFloat(klineData[4]),
      volume: parseFloat(klineData[5])
    };

    ohlcBuffer.push(ohlcCandle);
    
    if (ohlcBuffer.length > MAX_BUFFER_SIZE) {
      ohlcBuffer.shift();
    }

    console.log(`📊 [${apiUsed}] New Candle: ${ohlcCandle.close.toFixed(2)} | Buffer: ${ohlcBuffer.length}/${MAX_BUFFER_SIZE}`);

    // Calculate indicator signals
    let indicatorSignal = null;
    if (ohlcBuffer.length >= indicator.len * 2 + 10) {
      const results = indicator.calculate(ohlcBuffer);
      const latestResult = results[results.length - 1];
      
      if (latestResult.cisd !== 0 || latestResult.bearishSweep || latestResult.bullishSweep) {
        indicatorSignal = {
          cisd: latestResult.cisd,
          cisdLevel: latestResult.cisdLevel,
          trend: latestResult.trend,
          bearishSweep: latestResult.bearishSweep,
          bullishSweep: latestResult.bullishSweep,
          swingHigh: latestResult.swingHigh,
          swingLow: latestResult.swingLow
        };
        
        if (latestResult.bullishSweep) {
          console.log('🟢 STRONG BULLISH SIGNAL - Bullish CISD with Liquidity Sweep!');
          console.log(`   Price: ${ohlcCandle.close.toFixed(2)} | Level: ${latestResult.cisdLevel?.toFixed(2)}`);
          
          await createTrade(
            { bullishSweep: true, bearishSweep: false },
            ohlcCandle.close,
            'BTCUSDT'
          );
        } else if (latestResult.bearishSweep) {
          console.log('🔴 STRONG SELL SIGNAL - Bearish CISD with Liquidity Sweep!');
          console.log(`   Price: ${ohlcCandle.close.toFixed(2)} | Level: ${latestResult.cisdLevel?.toFixed(2)}`);
          
          await createTrade(
            { bullishSweep: false, bearishSweep: true },
            ohlcCandle.close,
            'BTCUSDT'
          );
        } else if (latestResult.cisd === 1) {
          console.log('🟢 Bullish CISD detected at', latestResult.cisdLevel?.toFixed(2));
        } else if (latestResult.cisd === -1) {
          console.log('🔴 Bearish CISD detected at', latestResult.cisdLevel?.toFixed(2));
        }
      }
    }

    await checkActiveTrades(ohlcCandle.close);

    const payload = {
      symbol: 'BTCUSDT',
      open: ohlcCandle.open,
      high: ohlcCandle.high,
      low: ohlcCandle.low,
      close: ohlcCandle.close,
      volume: ohlcCandle.volume,
      isClosed: true,
      time: ohlcCandle.timestamp,
      indicator: indicatorSignal,
      bufferSize: ohlcBuffer.length,
      activeTrades: activeTrades.size,
      apiSource: apiUsed
    };

    io.emit("binance_kline", payload);
    
    if (indicatorSignal) {
      io.emit("cisd_signal", {
        ...payload,
        signal: indicatorSignal
      });
    }

  } catch (error) {
    if (error.response?.status === 451) {
      console.error(`❌ All APIs blocked with 451 error. Please use a VPN or deploy to a different region.`);
    } else if (error.code === 'ECONNABORTED') {
      console.error("⏱️ API request timeout");
    } else if (error.response) {
      console.error(`❌ API error: ${error.response.status} - ${error.response.statusText}`);
    } else {
      console.error("❌ Error fetching data:", error.message);
    }
  }
};

const connectBinance = (io) => {
  if (pollingInterval) {
    console.log("⚠️ Binance polling already running");
    return;
  }

  console.log("✅ Starting crypto data polling with multiple API fallbacks");
  
  fetchBinanceData(io);
  
  pollingInterval = setInterval(() => {
    fetchBinanceData(io);
  }, 5000); // Check every 5 seconds
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
  createTrade,
  checkActiveTrades
};








// const axios = require('axios');
// const CISDIndicator = require('../services/Indicator');
// const Trade = require('../models/Trade');

// // Store historical OHLC data for indicator calculation
// const ohlcBuffer = [];
// const MAX_BUFFER_SIZE = 500;

// // Store active trades for monitoring
// const activeTrades = new Map();

// // Initialize indicator
// const indicator = new CISDIndicator({
//     tolerance: 0.7,
//     swingPeriod: 12,
//     expiryBars: 100,
//     liquidityLookback: 10
// });

// let pollingInterval = null;

// let lastCandleTime = null;

// // Binance REST API endpoint
// const BINANCE_API = "https://api.binance.com/api/v3/klines";

// // Helper function to create a trade
// const createTrade = async (signal, price, symbol) => {
//   try {
//     const direction = signal.bullishSweep ? 'BUY' : 'SELL';
//     const entryPrice = price;
//     const stopLoss = direction === 'BUY' 
//       ? entryPrice * (1 - 0.008)
//       : entryPrice * (1 + 0.008);
    
//     const target = direction === 'BUY'
//       ? entryPrice * (1 + 0.012)
//       : entryPrice * (1 - 0.012);
    
//     const tradedQuantity = 50;

//     const trade = new Trade({
//       name: `${symbol} ${direction} Signal`,
//       entryPrice: entryPrice,
//       direction: direction,
//       stopLoss: stopLoss,
//       target: target,
//       tradedQuantity: tradedQuantity,
//       currentStatus: 'PENDING',
//       tradeStatus: 'OPEN',
//       symbol: symbol,
//       signalType: signal.bullishSweep ? 'STRONG_BULLISH' : 'STRONG_BEARISH',
//       entryTime: new Date()
//     });

//     await trade.save();
//     activeTrades.set(trade._id.toString(), trade);
    
//     console.log(`✅ Trade Created: ${direction} ${symbol} at ${entryPrice.toFixed(2)}`);
//     console.log(`   SL: ${stopLoss.toFixed(2)} | Target: ${target.toFixed(2)}`);
    
//     return trade;
//   } catch (error) {
//     console.error('Error creating trade:', error.message);
//     return null;
//   }
// };

// // Helper function to check and update active trades
// const checkActiveTrades = async (currentPrice) => {
//   for (const [tradeId, trade] of activeTrades.entries()) {
//     try {
//       let shouldUpdate = false;
//       let newStatus = 'PENDING';
//       let tradeResult = 'OPEN';

//       if (trade.direction === 'BUY') {
//         if (currentPrice >= trade.target) {
//           shouldUpdate = true;
//           newStatus = 'COMPLETED';
//           tradeResult = 'WINNER';
//           console.log(`🎯 Target Hit! Trade #${tradeId} - WINNER`);
//         }
//         else if (currentPrice <= trade.stopLoss) {
//           shouldUpdate = true;
//           newStatus = 'COMPLETED';
//           tradeResult = 'LOSER';
//           console.log(`🛑 Stop Loss Hit! Trade #${tradeId} - LOSER`);
//         }
//       } else if (trade.direction === 'SELL') {
//         if (currentPrice <= trade.target) {
//           shouldUpdate = true;
//           newStatus = 'COMPLETED';
//           tradeResult = 'WINNER';
//           console.log(`🎯 Target Hit! Trade #${tradeId} - WINNER`);
//         }
//         else if (currentPrice >= trade.stopLoss) {
//           shouldUpdate = true;
//           newStatus = 'COMPLETED';
//           tradeResult = 'LOSER';
//           console.log(`🛑 Stop Loss Hit! Trade #${tradeId} - LOSER`);
//         }
//       }

//       if (shouldUpdate) {
//         await Trade.findByIdAndUpdate(tradeId, {
//           currentStatus: newStatus,
//           tradeStatus: tradeResult,
//           exitPrice: currentPrice,
//           exitTime: new Date(),
//           profitLoss: trade.direction === 'BUY' 
//             ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
//             : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100
//         });
        
//         activeTrades.delete(tradeId);
//       }
//     } catch (error) {
//       console.error(`Error updating trade ${tradeId}:`, error.message);
//     }
//   }
// };

// // Fetch Binance data via REST API
// const fetchBinanceData = async (io) => {
//   try {
//     const response = await axios.get(BINANCE_API, {
//       params: {
//         symbol: 'BTCUSDT',
//         interval: '1s',
//         limit: 2 // Get last 2 candles to ensure we have closed candle
//       },
//       timeout: 10000 // 10 second timeout
//     });

//     if (!response.data || response.data.length === 0) {
//       console.error('No data received from Binance');
//       return;
//     }

//     // Get the latest closed candle (second-to-last if current is still open)
//     const klineData = response.data[0];
//     const currentKline = response.data[1]; // Current candle for real-time price
    
//     const candleCloseTime = klineData[6]; // Close time
    
//     // Only process if this is a new candle (avoid duplicates)
//     if (lastCandleTime === candleCloseTime) {
//       // Update current price for active trades monitoring
//       const currentPrice = parseFloat(currentKline[4]);
//       await checkActiveTrades(currentPrice);
      
//       // Emit real-time update
//       io.emit("binance_kline", {
//         symbol: 'BTCUSDT',
//         open: parseFloat(currentKline[1]),
//         high: parseFloat(currentKline[2]),
//         low: parseFloat(currentKline[3]),
//         close: currentPrice,
//         volume: parseFloat(currentKline[5]),
//         isClosed: false,
//         time: currentKline[0],
//         indicator: null,
//         bufferSize: ohlcBuffer.length,
//         activeTrades: activeTrades.size
//       });
//       return;
//     }
    
//     lastCandleTime = candleCloseTime;

//     const ohlcCandle = {
//       timestamp: klineData[0],
//       open: parseFloat(klineData[1]),
//       high: parseFloat(klineData[2]),
//       low: parseFloat(klineData[3]),
//       close: parseFloat(klineData[4]),
//       volume: parseFloat(klineData[5])
//     };

//     // Add to buffer
//     ohlcBuffer.push(ohlcCandle);
    
//     if (ohlcBuffer.length > MAX_BUFFER_SIZE) {
//       ohlcBuffer.shift();
//     }

//     console.log(`📊 New Candle: ${ohlcCandle.close.toFixed(2)} | Buffer: ${ohlcBuffer.length}/${MAX_BUFFER_SIZE}`);

//     // Calculate indicator signals
//     let indicatorSignal = null;
//     if (ohlcBuffer.length >= indicator.len * 2 + 10) {
//       const results = indicator.calculate(ohlcBuffer);
//       const latestResult = results[results.length - 1];
      
//       if (latestResult.cisd !== 0 || latestResult.bearishSweep || latestResult.bullishSweep) {
//         indicatorSignal = {
//           cisd: latestResult.cisd,
//           cisdLevel: latestResult.cisdLevel,
//           trend: latestResult.trend,
//           bearishSweep: latestResult.bearishSweep,
//           bullishSweep: latestResult.bullishSweep,
//           swingHigh: latestResult.swingHigh,
//           swingLow: latestResult.swingLow
//         };
        
//         if (latestResult.bullishSweep) {
//           console.log('🟢 STRONG BULLISH SIGNAL - Bullish CISD with Liquidity Sweep!');
//           console.log(`   Price: ${ohlcCandle.close.toFixed(2)} | Level: ${latestResult.cisdLevel?.toFixed(2)}`);
          
//           await createTrade(
//             { bullishSweep: true, bearishSweep: false },
//             ohlcCandle.close,
//             'BTCUSDT'
//           );
//         } else if (latestResult.bearishSweep) {
//           console.log('🔴 STRONG SELL SIGNAL - Bearish CISD with Liquidity Sweep!');
//           console.log(`   Price: ${ohlcCandle.close.toFixed(2)} | Level: ${latestResult.cisdLevel?.toFixed(2)}`);
          
//           await createTrade(
//             { bullishSweep: false, bearishSweep: true },
//             ohlcCandle.close,
//             'BTCUSDT'
//           );
//         } else if (latestResult.cisd === 1) {
//           console.log('🟢 Bullish CISD detected at', latestResult.cisdLevel?.toFixed(2));
//         } else if (latestResult.cisd === -1) {
//           console.log('🔴 Bearish CISD detected at', latestResult.cisdLevel?.toFixed(2));
//         }
//       }
//     }

//     // Check active trades with closed candle price
//     await checkActiveTrades(ohlcCandle.close);

//     const payload = {
//       symbol: 'BTCUSDT',
//       open: ohlcCandle.open,
//       high: ohlcCandle.high,
//       low: ohlcCandle.low,
//       close: ohlcCandle.close,
//       volume: ohlcCandle.volume,
//       isClosed: true,
//       time: ohlcCandle.timestamp,
//       indicator: indicatorSignal,
//       bufferSize: ohlcBuffer.length,
//       activeTrades: activeTrades.size
//     };

//     io.emit("binance_kline", payload);
    
//     if (indicatorSignal) {
//       io.emit("cisd_signal", {
//         ...payload,
//         signal: indicatorSignal
//       });
//     }

//   } catch (error) {
//     if (error.code === 'ECONNABORTED') {
//       console.error("⏱️ Binance API request timeout");
//     } else if (error.response) {
//       console.error(`❌ Binance API error: ${error.response.status} - ${error.response.statusText}`);
//     } else {
//       console.error("❌ Error fetching Binance data:", error.message);
//     }
//   }
// };

// const connectBinance = (io) => {
//   if (pollingInterval) {
//     console.log("⚠️ Binance polling already running");
//     return;
//   }

//   console.log("✅ Starting Binance REST API polling (1-minute intervals)");
  
//   // Fetch immediately on start
//   fetchBinanceData(io);
  
//   // Poll every 5 seconds to catch new candles quickly and update active trades
//   pollingInterval = setInterval(() => {
//     fetchBinanceData(io);
//   }, 2000); // Check every 5 seconds for new candles
// };

// // Stop polling (useful for cleanup)
// const disconnectBinance = () => {
//   if (pollingInterval) {
//     clearInterval(pollingInterval);
//     pollingInterval = null;
//     console.log("❌ Binance polling stopped");
//   }
// };

// // Helper function to get current buffer status
// const getBufferStatus = () => {
//   return {
//     size: ohlcBuffer.length,
//     minRequired: indicator.len * 2 + 10,
//     ready: ohlcBuffer.length >= indicator.len * 2 + 10,
//     firstCandle: ohlcBuffer[0]?.timestamp || null,
//     lastCandle: ohlcBuffer[ohlcBuffer.length - 1]?.timestamp || null,
//     lastCandleTime: lastCandleTime,
//     isPolling: pollingInterval !== null
//   };
// };

// // Helper function to manually trigger calculation
// const calculateIndicator = () => {
//   if (ohlcBuffer.length < indicator.len * 2 + 10) {
//     return { error: 'Not enough data', bufferStatus: getBufferStatus() };
//   }
  
//   const results = indicator.calculate(ohlcBuffer);
//   return results;
// };

// module.exports = { 
//   connectBinance,
//   disconnectBinance,
//   getBufferStatus, 
//   calculateIndicator,
//   ohlcBuffer,
//   activeTrades,
//   createTrade,
//   checkActiveTrades
// };