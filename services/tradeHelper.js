const Candle = require("../models/Candle");


const TakeSellTrade=async()=>{

}

const TakeBuyTrade =async()=>{

}

const CloseTrade=async()=>{

}


const CheckTradeConfirmation=async()=>{

}


const CheckOnGoingTrade=async()=>{

}


async function trimOldCandles(symbol, timeframe, limit = 50) {
  const oldIds = await Candle
    .find(
      { symbol, timeframe },
      { _id: 1 }
    )
    .sort({ openTime: -1 }) // newest first
    .skip(limit)
    .lean();

  if (oldIds.length) {
    await Candle.deleteMany({
      _id: { $in: oldIds.map(d => d._id) }
    });
  }
}


async function upsertCandle(candle) {
  await Candle.updateOne(
    {
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      openTime: candle.openTime,
    },
    {
      $set: {
        ...candle
      }
    },
    {
      upsert: true
    }
  );
}
function mapCandle(closed, source) {
  return {
    symbol: "BTCUSDT",
    timeframe: "1m",
    openTime: Number(closed[0]),
    open: Number(closed[1]),
    high: Number(closed[2]),
    low: Number(closed[3]),
    close: Number(closed[4]),
    volume: Number(closed[5]),
    closeTime: Number(closed[6]),
    source
  };
}



module.exports={
    TakeSellTrade,
    TakeBuyTrade,
    CloseTrade,
    CheckTradeConfirmation,
    CheckOnGoingTrade,
    trimOldCandles,
    upsertCandle,
    mapCandle
}