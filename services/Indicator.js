/**
 * Change in State of Delivery (CISD) Indicator
 * Converted from Pine Script to Node.js
 * @version 1.0.0
 */

class CISDIndicator {
    constructor(config = {}) {
        // Configuration
        this.tolerance = config.tolerance ?? 0.7;
        this.len = config.swingPeriod ?? 12;
        this.expiryBars = config.expiryBars ?? 100;
        this.liquidityLookback = config.liquidityLookback ?? 10;
        this.hideMitigatedLevels = config.hideMitigatedLevels ?? false;
        this.hideExpiredLevels = config.hideExpiredLevels ?? true;
        
        // State variables
        this.swingHighs = [];
        this.swingLows = [];
        this.bearPotential = [];
        this.bullPotential = [];
        this.lastWickedHighLevel = null;
        this.lastWickedLowLevel = null;
        this.trend = 0;
    }

    /**
     * Detect pivot high
     */
    pivotHigh(data, index, leftBars, rightBars) {
        if (index < leftBars || index >= data.length - rightBars) return null;
        
        const centerHigh = data[index].high;
        
        for (let i = 1; i <= leftBars; i++) {
            if (data[index - i].high >= centerHigh) return null;
        }
        
        for (let i = 1; i <= rightBars; i++) {
            if (data[index + i].high > centerHigh) return null;
        }
        
        return centerHigh;
    }

    /**
     * Detect pivot low
     */
    pivotLow(data, index, leftBars, rightBars) {
        if (index < leftBars || index >= data.length - rightBars) return null;
        
        const centerLow = data[index].low;
        
        for (let i = 1; i <= leftBars; i++) {
            if (data[index - i].low <= centerLow) return null;
        }
        
        for (let i = 1; i <= rightBars; i++) {
            if (data[index + i].low < centerLow) return null;
        }
        
        return centerLow;
    }

    /**
     * Calculate bars since condition was true
     */
    barsSince(conditions, currentIndex) {
        for (let i = currentIndex - 1; i >= 0; i--) {
            if (conditions[i]) return currentIndex - i;
        }
        return Infinity;
    }

    /**
     * Process OHLC data and calculate CISD signals
     */
    calculate(ohlcData) {
        const results = [];
        const wickedHighs = [];
        const wickedLows = [];
        
        // Reset state
        this.swingHighs = [];
        this.swingLows = [];
        this.bearPotential = [];
        this.bullPotential = [];
        
        for (let bar = 0; bar < ohlcData.length; bar++) {
            const candle = ohlcData[bar];
            const result = {
                index: bar,
                timestamp: candle.timestamp,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                swingHigh: null,
                swingLow: null,
                cisd: 0,
                cisdLevel: null,
                wickedHigh: false,
                wickedLow: false,
                bearishSweep: false,
                bullishSweep: false,
                trend: this.trend
            };

            // Detect pivot points
            const pivHigh = this.pivotHigh(ohlcData, bar, this.len, this.len);
            const pivLow = this.pivotLow(ohlcData, bar, this.len, this.len);

            if (pivHigh !== null) {
                this.swingHighs.unshift({
                    level: pivHigh,
                    startBar: bar - this.len,
                    active: true
                });
                result.swingHigh = pivHigh;
            }

            if (pivLow !== null) {
                this.swingLows.unshift({
                    level: pivLow,
                    startBar: bar - this.len,
                    active: true
                });
                result.swingLow = pivLow;
            }

            // Update and check swing highs
            for (let i = this.swingHighs.length - 1; i >= 0; i--) {
                const swing = this.swingHighs[i];
                
                if (bar - swing.startBar < this.expiryBars && swing.active) {
                    if (candle.high >= swing.level) {
                        result.wickedHigh = true;
                        wickedHighs[bar] = true;
                        this.lastWickedHighLevel = swing.level;
                        
                        if (this.hideMitigatedLevels) {
                            swing.active = false;
                        }
                    }
                } else if (this.hideExpiredLevels) {
                    swing.active = false;
                }
            }

            // Update and check swing lows
            for (let i = this.swingLows.length - 1; i >= 0; i--) {
                const swing = this.swingLows[i];
                
                if (bar - swing.startBar < this.expiryBars && swing.active) {
                    if (candle.low <= swing.level) {
                        result.wickedLow = true;
                        wickedLows[bar] = true;
                        this.lastWickedLowLevel = swing.level;
                        
                        if (this.hideMitigatedLevels) {
                            swing.active = false;
                        }
                    }
                } else if (this.hideExpiredLevels) {
                    swing.active = false;
                }
            }

            // Limit array sizes
            if (this.swingHighs.length > 100) this.swingHighs = this.swingHighs.slice(0, 100);
            if (this.swingLows.length > 100) this.swingLows = this.swingLows.slice(0, 100);

            // Track potential bearish CISD
            if (bar > 0) {
                const prevCandle = ohlcData[bar - 1];
                
                if (prevCandle.close < prevCandle.open && candle.close > candle.open) {
                    this.bearPotential.unshift({ bar, level: candle.open });
                }
                
                if (prevCandle.close > prevCandle.open && candle.close < candle.open) {
                    this.bullPotential.unshift({ bar, level: candle.open });
                }
            }

            // Check for bearish CISD
            if (this.bearPotential.length > 0) {
                for (let i = 0; i < this.bearPotential.length; i++) {
                    const potential = this.bearPotential[i];
                    
                    if (candle.close < potential.level) {
                        let highest = 0;
                        for (let j = 0; j <= bar - potential.bar; j++) {
                            if (ohlcData[bar - j].close > highest) {
                                highest = ohlcData[bar - j].close;
                            }
                        }
                        
                        let top = 0;
                        let init = potential.bar + 1;
                        while (init < bar && ohlcData[init].close < ohlcData[init].open) {
                            top = ohlcData[init].open;
                            init++;
                        }
                        
                        if (top > 0 && (highest - potential.level) / (top - potential.level) > this.tolerance) {
                            result.cisd = -1;
                            result.cisdLevel = potential.level;
                            this.trend = -1;
                            this.bearPotential = [];
                            
                            const barsSinceHigh = this.barsSince(wickedHighs, bar);
                            if (barsSinceHigh <= this.liquidityLookback && 
                                this.lastWickedHighLevel !== null && 
                                candle.close < this.lastWickedHighLevel) {
                                result.bearishSweep = true;
                            }
                            break;
                        }
                    }
                }
            }

            // Check for bullish CISD
            if (this.bullPotential.length > 0) {
                for (let i = 0; i < this.bullPotential.length; i++) {
                    const potential = this.bullPotential[i];
                    
                    if (candle.close > potential.level) {
                        let lowest = candle.close;
                        for (let j = 0; j <= bar - potential.bar; j++) {
                            if (ohlcData[bar - j].close < lowest) {
                                lowest = ohlcData[bar - j].close;
                            }
                        }
                        
                        let bottom = 0;
                        let init = potential.bar + 1;
                        while (init < bar && ohlcData[init].close > ohlcData[init].open) {
                            bottom = ohlcData[init].open;
                            init++;
                        }
                        
                        if (bottom > 0 && (potential.level - lowest) / (potential.level - bottom) > this.tolerance) {
                            result.cisd = 1;
                            result.cisdLevel = potential.level;
                            this.trend = 1;
                            this.bullPotential = [];
                            
                            const barsSinceLow = this.barsSince(wickedLows, bar);
                            if (barsSinceLow <= this.liquidityLookback && 
                                this.lastWickedLowLevel !== null && 
                                candle.close > this.lastWickedLowLevel) {
                                result.bullishSweep = true;
                            }
                            break;
                        }
                    }
                }
            }

            result.trend = this.trend;
            results.push(result);
        }

        return results;
    }

    /**
     * Get active swing levels
     */
    getActiveSwingLevels() {
        return {
            highs: this.swingHighs.filter(s => s.active),
            lows: this.swingLows.filter(s => s.active)
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CISDIndicator;
}

// Example usage
if (require.main === module) {
    // Generate sample OHLC data for demonstration
    function generateSampleData(bars = 200) {
        const data = [];
        let price = 100;
        
        for (let i = 0; i < bars; i++) {
            const change = (Math.random() - 0.5) * 4;
            const open = price;
            const close = price + change;
            const high = Math.max(open, close) + Math.random() * 2;
            const low = Math.min(open, close) - Math.random() * 2;
            
            data.push({
                timestamp: Date.now() + i * 60000,
                open,
                high,
                low,
                close
            });
            
            price = close;
        }
        
        return data;
    }

    // Run example
    const indicator = new CISDIndicator({
        tolerance: 0.7,
        swingPeriod: 12,
        expiryBars: 100,
        liquidityLookback: 10
    });

    const ohlcData = generateSampleData(200);
    const results = indicator.calculate(ohlcData);

    // Display signals
    console.log('\n📊 CISD Indicator Results\n');
    console.log('='.repeat(60));
    
    results.forEach(result => {
        if (result.cisd !== 0 || result.bearishSweep || result.bullishSweep) {
            console.log(`\nBar ${result.index}:`);
            console.log(`  Price: ${result.close.toFixed(2)}`);
            
            if (result.cisd === 1) {
                console.log(`  🟢 Bullish CISD detected at ${result.cisdLevel.toFixed(2)}`);
            } else if (result.cisd === -1) {
                console.log(`  🔴 Bearish CISD detected at ${result.cisdLevel.toFixed(2)}`);
            }
            
            if (result.bullishSweep) {
                console.log(`  ⬆️  STRONG Bullish CISD with Liquidity Sweep!`);
            }
            if (result.bearishSweep) {
                console.log(`  ⬇️  STRONG Bearish CISD with Liquidity Sweep!`);
            }
        }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`\nTotal bars processed: ${results.length}`);
    console.log(`Bullish signals: ${results.filter(r => r.cisd === 1).length}`);
    console.log(`Bearish signals: ${results.filter(r => r.cisd === -1).length}`);
    console.log(`Bullish sweeps: ${results.filter(r => r.bullishSweep).length}`);
    console.log(`Bearish sweeps: ${results.filter(r => r.bearishSweep).length}\n`);
}