const CISDIndicator = require('../services/Indicator'); // Your CISD file
const Candle = require('../models/Candle'); // Your Candle model

class CISDSignalService {
    constructor(config = {}) {
        this.indicator = new CISDIndicator({
            tolerance: config.tolerance ?? 0.7,
            swingPeriod: config.swingPeriod ?? 12,
            expiryBars: config.expiryBars ?? 100,
            liquidityLookback: config.liquidityLookback ?? 10
        });
        
        this.symbol = config.symbol;
        this.timeframe = config.timeframe || '1m';
    }

    /**
     * Fetch latest 50 candles from MongoDB
     */
    async fetchCandles(symbol, timeframe, limit = 50) {
        try {
            const candles = await Candle.find({
                symbol,
                timeframe
            })
            .sort({ openTime: -1 })
            .limit(limit)
            .lean();

            // Reverse to get chronological order (oldest to newest)
            return candles.reverse();
        } catch (error) {
            console.error('Error fetching candles:', error);
            throw error;
        }
    }

    /**
     * Convert MongoDB candles to CISD format
     */
    formatCandlesForCISD(candles) {
        return candles.map(candle => ({
            timestamp: candle.openTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
        }));
    }

    /**
     * Analyze candles and return signal
     */
    analyzeCandles(candles) {
        const ohlcData = this.formatCandlesForCISD(candles);
        const results = this.indicator.calculate(ohlcData);
        
        // Get the latest result (most recent candle)
        const latestResult = results[results.length - 1];
        
        // Determine signal strength
        let signal = 'NEUTRAL';
        let strength = 'NONE';
        let confidence = 0;
        
        if (latestResult.cisd === 1) {
            signal = 'BULLISH';
            strength = latestResult.bullishSweep ? 'STRONG' : 'NORMAL';
            confidence = latestResult.bullishSweep ? 85 : 65;
        } else if (latestResult.cisd === -1) {
            signal = 'BEARISH';
            strength = latestResult.bearishSweep ? 'STRONG' : 'NORMAL';
            confidence = latestResult.bearishSweep ? 85 : 65;
        } else if (latestResult.trend === 1) {
            signal = 'BULLISH';
            strength = 'WEAK';
            confidence = 40;
        } else if (latestResult.trend === -1) {
            signal = 'BEARISH';
            strength = 'WEAK';
            confidence = 40;
        }

        return {
            signal, // BULLISH, BEARISH, NEUTRAL
            strength, // STRONG, NORMAL, WEAK, NONE
            confidence, // 0-100
            price: latestResult.close,
            timestamp: latestResult.timestamp,
            details: {
                cisd: latestResult.cisd,
                cisdLevel: latestResult.cisdLevel,
                trend: latestResult.trend,
                bullishSweep: latestResult.bullishSweep,
                bearishSweep: latestResult.bearishSweep,
                swingHigh: latestResult.swingHigh,
                swingLow: latestResult.swingLow
            }
        };
    }

    /**
     * Get signal for specific symbol
     */
    async getSignal(symbol = this.symbol, timeframe = this.timeframe) {
        try {
            const candles = await this.fetchCandles(symbol, timeframe, 50);
            
            if (candles.length < 50) {
                return {
                    signal: 'INSUFFICIENT_DATA',
                    strength: 'NONE',
                    confidence: 0,
                    error: `Only ${candles.length} candles available, need 50`
                };
            }

            return this.analyzeCandles(candles);
        } catch (error) {
            console.error('Error getting signal:', error);
            return {
                signal: 'ERROR',
                strength: 'NONE',
                confidence: 0,
                error: error.message
            };
        }
    }

    /**
     * Get formatted signal output
     */
    async getFormattedSignal(symbol = this.symbol, timeframe = this.timeframe) {
        const result = await this.getSignal(symbol, timeframe);
        
        let emoji = '⚪';
        if (result.strength === 'STRONG' && result.signal === 'BULLISH') emoji = '🟢🟢';
        else if (result.signal === 'BULLISH') emoji = '🟢';
        else if (result.strength === 'STRONG' && result.signal === 'BEARISH') emoji = '🔴🔴';
        else if (result.signal === 'BEARISH') emoji = '🔴';

        return {
            ...result,
            message: `${emoji} ${result.signal} ${result.strength !== 'NONE' ? `(${result.strength})` : ''} - Confidence: ${result.confidence}%`
        };
    }
}

module.exports = CISDSignalService;
