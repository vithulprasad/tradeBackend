const WebSocket = require("ws");
const CISDIndicator = require('../services/Indicator');
const Trade = require('../models/Trade'); // Import Trade model

// Store historical OHLC data for indicator calculation
const ohlcBuffer = [];
const MAX_BUFFER_SIZE = 500; // Keep last 500 candles

// Store active trades for monitoring
const activeTrades = new Map();

// Initialize indicator
const indicator = new CISDIndicator({
    tolerance: 0.7,
    swingPeriod: 12,
    expiryBars: 100,
    liquidityLookback: 10
});

let binanceWS = null;

// Helper function to create a trade
const createTrade = async (signal, price, symbol) => {
  try {
    const direction = signal.bullishSweep ? 'BUY' : 'SELL';
    const entryPrice = price;
    const stopLoss = direction === 'BUY' 
      ? entryPrice * (1 - 0.008)  // 0.8% below for buy
      : entryPrice * (1 + 0.008); // 0.8% above for sell
    
    const target = direction === 'BUY'
      ? entryPrice * (1 + 0.012)  // 1.2% above for buy
      : entryPrice * (1 - 0.012); // 1.2% below for sell
    
    const tradedQuantity = 50; // 50% quantity

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
    
    // Store in active trades map for monitoring
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
        // Check if target hit (price went up)
        if (currentPrice >= trade.target) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'WINNER';
          console.log(`🎯 Target Hit! Trade #${tradeId} - WINNER`);
        }
        // Check if stop loss hit (price went down)
        else if (currentPrice <= trade.stopLoss) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'LOSER';
          console.log(`🛑 Stop Loss Hit! Trade #${tradeId} - LOSER`);
        }
      } else if (trade.direction === 'SELL') {
        // Check if target hit (price went down)
        if (currentPrice <= trade.target) {
          shouldUpdate = true;
          newStatus = 'COMPLETED';
          tradeResult = 'WINNER';
          console.log(`🎯 Target Hit! Trade #${tradeId} - WINNER`);
        }
        // Check if stop loss hit (price went up)
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
        
        // Remove from active trades
        activeTrades.delete(tradeId);
      }
    } catch (error) {
      console.error(`Error updating trade ${tradeId}:`, error.message);
    }
  }
};

const connectBinance = (io) => {
  if (binanceWS) return; // 🔥 prevent multiple connections

  binanceWS = new WebSocket(
    "wss://stream.binance.com:9443/ws/btcusdt@kline_1m" // Changed to 1m for better indicator performance
  );

  binanceWS.on("open", () => {
    console.log("✅ Connected to Binance WS");
  });

  binanceWS.on("message", async(data) => {
    try {
      const message = JSON.parse(data);
      const kline = message.k;

      // Build OHLC object for indicator
      const ohlcCandle = {
        timestamp: kline.t,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
      };

      // Only process closed candles for indicator calculation
      if (kline.x) { // isClosed
        // Add to buffer
        ohlcBuffer.push(ohlcCandle);
        
        // Maintain buffer size
        if (ohlcBuffer.length > MAX_BUFFER_SIZE) {
          ohlcBuffer.shift();
        }

        // Calculate indicator signals if we have enough data
        let indicatorSignal = null;
        if (ohlcBuffer.length >= indicator.len * 2 + 10) { // Need enough data for pivot detection
          const results = indicator.calculate(ohlcBuffer);
          const latestResult = results[results.length - 1];
          
          // Check for signals
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
            
            // Console log based on signal type and create trade
            if (latestResult.bullishSweep) {
              console.log('🟢 STRONG BULLISH SIGNAL - Bullish CISD with Liquidity Sweep!');
              console.log(`   Price: ${ohlcCandle.close.toFixed(2)} | Level: ${latestResult.cisdLevel?.toFixed(2)}`);
              
              // Create BUY trade
              await createTrade(
                { bullishSweep: true, bearishSweep: false },
                ohlcCandle.close,
                kline.s
              );
            } else if (latestResult.bearishSweep) {
              console.log('🔴 STRONG SELL SIGNAL - Bearish CISD with Liquidity Sweep!');
              console.log(`   Price: ${ohlcCandle.close.toFixed(2)} | Level: ${latestResult.cisdLevel?.toFixed(2)}`);
              
              // Create SELL trade
              await createTrade(
                { bullishSweep: false, bearishSweep: true },
                ohlcCandle.close,
                kline.s
              );
            } else if (latestResult.cisd === 1) {
              console.log('🟢 Bullish CISD detected at', latestResult.cisdLevel?.toFixed(2));
            } else if (latestResult.cisd === -1) {
              console.log('🔴 Bearish CISD detected at', latestResult.cisdLevel?.toFixed(2));
            }
          }
        }

        const payload = {
          symbol: kline.s,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
          volume: parseFloat(kline.v),
          isClosed: kline.x,
          time: kline.t,
          indicator: indicatorSignal, // Include indicator signals
          bufferSize: ohlcBuffer.length // For debugging
        };

        // 🔥 Emit to ALL socket.io clients
        io.emit("binance_kline", payload);
        
        // Emit separate event for signals
        if (indicatorSignal) {
          io.emit("cisd_signal", {
            ...payload,
            signal: indicatorSignal
          });
        }
      } else {
        // For real-time updates (non-closed candles), still emit without indicator
        // Also check active trades with current price
        await checkActiveTrades(parseFloat(kline.c));
        
        const payload = {
          symbol: kline.s,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
          volume: parseFloat(kline.v),
          isClosed: kline.x,
          time: kline.t,
          indicator: null,
          bufferSize: ohlcBuffer.length,
          activeTrades: activeTrades.size
        };
        
        io.emit("binance_kline", payload);
      }

    } catch (error) {
      console.error("Error processing Binance message:", error.message);
    }
  });

  binanceWS.on("close", () => {
    console.log("❌ Binance WS closed. Reconnecting...");
    binanceWS = null;
    setTimeout(() => connectBinance(io), 3000);
  });

  binanceWS.on("error", (err) => {
    console.error("Binance WS error:", err.message);
  });
};

// Helper function to get current buffer status
const getBufferStatus = () => {
  return {
    size: ohlcBuffer.length,
    minRequired: indicator.len * 2 + 10,
    ready: ohlcBuffer.length >= indicator.len * 2 + 10,
    firstCandle: ohlcBuffer[0]?.timestamp || null,
    lastCandle: ohlcBuffer[ohlcBuffer.length - 1]?.timestamp || null
  };
};

// Helper function to manually trigger calculation (useful for testing)
const calculateIndicator = () => {
  if (ohlcBuffer.length < indicator.len * 2 + 10) {
    return { error: 'Not enough data', bufferStatus: getBufferStatus() };
  }
  
  const results = indicator.calculate(ohlcBuffer);
  return results;
};

module.exports = { 
  connectBinance, 
  getBufferStatus, 
  calculateIndicator,
  ohlcBuffer, // Export for external access if needed
  activeTrades, // Export active trades
  createTrade, // Export trade creation function
  checkActiveTrades // Export trade checking function
};