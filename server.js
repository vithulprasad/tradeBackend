const express = require("express");
const http = require("http");
const mongoose = require('mongoose');
const { initSocket , getTradeDetails} = require("./socket");
require('dotenv').config();
const axios = require('axios');
const app = express();
const server = http.createServer(app);
const { connectBinance, getBufferStatus, activeTrades } = require('./services/binance.ws');
const cors = require('cors');
const SignalDb = require('./models/Signal')
app.use(
  cors({
    // origin: "http://localhost:8080",
    origin: "https://vidhultrade.netlify.app/",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true, // if you use cookies / auth headers
  })
);

// MongoDB connection
const MONGODB_URL = process.env.MONGODB_URL;

mongoose.connect(MONGODB_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error', err));

initSocket(server);

// Health check endpoint
app.get('/health', (req, res) => {
  const bufferStatus = getBufferStatus();
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    bufferSize: bufferStatus.size,
    bufferReady: bufferStatus.ready,
    activeTrades: activeTrades.size,
    isPolling: bufferStatus.isPolling
  });
});

app.get('/broadcastTradeDetails',async(req,res)=>{
  try {
     const response = await getTradeDetails()
     res.json({success:true,message:response})
  } catch (error) {
    res.json({success:false,message:error.message})
  }
})



app.get("/get_signal_details", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      direction,
      startDate,
      endDate,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    console.log('get detais----',req.query)
    /* -------------------- FILTER OBJECT -------------------- */
    const filter = {};

    // BUY / SELL filter
    if (direction) {
      filter.signal = direction.toUpperCase();
    }

    // Date range filter
    if (startDate || endDate) {
      filter.signalTime = {};

      if (startDate) {
        filter.signalTime.$gte = new Date(startDate);
      }

      if (endDate) {
        filter.signalTime.$lte = new Date(endDate);
      }
    }

    /* -------------------- QUERY -------------------- */
    const [signals, totalCount] = await Promise.all([
      SignalDb.find(filter)
        .sort({ signalTime: -1 }) // 🔥 latest first
        .skip(skip)
        .limit(limitNum),

      SignalDb.countDocuments(filter),
    ]);
    console.log(signals,totalCount,'----------------')
    res.json({
      success: true,
      data: signals,
      pagination: {
        totalRecords: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        currentPage: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.log(error.message)
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});




const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const PING_INTERVAL = 3 * 60 * 1000; // 3 minutes
const CLEANUP_INTERVAL = 3 * 60 * 1000; // 3 minutes

let appCache = {};

// ============================================
// FORCE GARBAGE COLLECTION
// ============================================
function forceGC() {
  if (global.gc) {
    console.log('🧹 Running garbage collection...');
    const before = process.memoryUsage().heapUsed / 1024 / 1024;
    global.gc();
    const after = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`✅ GC: ${before.toFixed(2)}MB → ${after.toFixed(2)}MB (freed ${(before - after).toFixed(2)}MB)`);
    return { before, after, freed: before - after };
  } else {
    console.log('⚠️  GC not available. Run with: node --expose-gc server.js');
    return null;
  }
}

// ============================================
// CLEAR CACHED DATA
// ============================================
function clearUnusedData() {
  console.log('🗑️  Clearing cached data...');
  
  // Clear app cache
  appCache = {};
  
  let clearedCount = 0;
  
  // Clear require cache for non-essential modules
  Object.keys(require.cache).forEach(key => {
    // Preserve critical modules
    if (!key.includes('node_modules/express') && 
        !key.includes('node_modules/mongoose') &&
        !key.includes('node_modules/socket.io') &&
        !key.includes('node_modules/body-parser') &&
        !key.includes('/socket') &&
        !key.includes('/services/binance.ws')) {
      delete require.cache[key];
      clearedCount++;
    }
  });
  
  console.log(`✅ Cache cleared (${clearedCount} modules)`);
  return clearedCount;
}

// ============================================
// CHECK MEMORY STATUS
// ============================================
function checkMemoryStatus() {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const heapTotalMB = usage.heapTotal / 1024 / 1024;
  const rssMB = usage.rss / 1024 / 1024;
  const externalMB = usage.external / 1024 / 1024;
  
  const memoryInfo = {
    heapUsed: heapUsedMB.toFixed(2),
    heapTotal: heapTotalMB.toFixed(2),
    rss: rssMB.toFixed(2),
    external: externalMB.toFixed(2),
    heapPercentage: ((heapUsedMB / heapTotalMB) * 100).toFixed(2)
  };
  
  console.log(`📊 Memory: Heap ${memoryInfo.heapUsed}/${memoryInfo.heapTotal}MB (${memoryInfo.heapPercentage}%) | RSS ${memoryInfo.rss}MB | External ${memoryInfo.external}MB`);
  
  return memoryInfo;
}

// ============================================
// PERFORM COMPLETE CLEANUP
// ============================================
function performCleanup() {
  console.log('\n========================================');
  console.log('🔧 STARTING 3-MINUTE CLEANUP CYCLE');
  console.log('========================================');
  
  // Check memory before cleanup
  console.log('📊 BEFORE CLEANUP:');
  const beforeMemory = checkMemoryStatus();
  
  // Force garbage collection
  const gcResult = forceGC();
  
  // Clear cached data
  const clearedModules = clearUnusedData();
  
  // Close idle connections if available
  if (server.closeIdleConnections) {
    server.closeIdleConnections();
    console.log('🔌 Closed idle connections');
  }
  
  // Check memory after cleanup
  console.log('\n📊 AFTER CLEANUP:');
  const afterMemory = checkMemoryStatus();
  
  console.log('\n✅ CLEANUP COMPLETED');
  console.log('========================================\n');
  
  return {
    beforeMemory,
    afterMemory,
    gcResult,
    clearedModules
  };
}

// ============================================
// SELF-PING WITH CLEANUP
// ============================================
const selfPing = async () => {
  try {
    const response = await axios.get(`${RENDER_URL}/health`, {
      timeout: 5000
    });

    console.log(`⏰ Keep-alive ping: ${response.data.status} | Uptime: ${response.data.uptime}s | Active Trades: ${response.data.activeTrades}`);
  } catch (error) {
    console.error('⏰ Keep-alive ping failed:', error.message);
  }
};

// ============================================
// START KEEP-ALIVE SERVICE
// ============================================
const startKeepAlive = () => {
  if (RENDER_URL) {
    console.log(`✅ Keep-alive enabled: pinging ${RENDER_URL} every 3 minutes`);
    
    // First ping after 1 minute
    setTimeout(selfPing, 1 * 60 * 1000);
    
    // Then ping every 3 minutes
    setInterval(selfPing, PING_INTERVAL);
  } else {
    console.log('ℹ️  Keep-alive disabled (RENDER_EXTERNAL_URL not set)');
  }
};

// ============================================
// START CLEANUP SCHEDULER
// ============================================
const startCleanupScheduler = () => {
  console.log('✅ Cleanup scheduler enabled: running every 3 minutes');
  
  // First cleanup after 3 minutes
  setTimeout(() => {
    console.log('🔧 Running first scheduled cleanup...');
    performCleanup();
  }, CLEANUP_INTERVAL);
  
  // Then cleanup every 3 minutes
  setInterval(() => {
    performCleanup();
  }, CLEANUP_INTERVAL);
};

// ============================================
// AGGRESSIVE MEMORY MONITORING
// ============================================
const startMemoryMonitoring = () => {
  // Monitor memory every minute
  setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const rssMB = usage.rss / 1024 / 1024;
    
    // If memory exceeds 400MB (Render has ~512MB), force immediate cleanup
    if (heapUsedMB > 400 || rssMB > 450) {
      console.log('\n⚠️  HIGH MEMORY ALERT! Forcing immediate cleanup...');
      performCleanup();
    }
  }, 60 * 1000); // Check every minute
  
  console.log('✅ Memory monitoring enabled: checking every minute');
};

// ============================================
// MANUAL CLEANUP ENDPOINT
// ============================================
app.get('/cleanup', (req, res) => {
  console.log('🧹 Manual cleanup requested via endpoint');
  const result = performCleanup();
  
  res.json({
    success: true,
    message: 'Cleanup performed successfully',
    ...result
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
const gracefulShutdown = (signal) => {
  console.log(`\n👋 ${signal} received`);
  console.log('🧹 Performing final cleanup...');
  
  performCleanup();
  
  server.close(() => {
    console.log('🛑 Server closed');
   mongoose.connection.close()
  .then(() => {
    console.log('MongoDB disconnected');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error closing DB:', err);
    process.exit(1);
  });

  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⏱️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  performCleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  performCleanup();
});

// ============================================
// START SERVER
// ============================================
server.listen(5000, () => {
  console.log('\n========================================');
  console.log('🚀 SERVER STARTED');
  console.log('========================================');
  console.log(`📡 Port: 5000`);
  console.log(`🕐 Time: ${new Date().toISOString()}`);
  console.log(`💻 Node: ${process.version}`);
  console.log(`🔧 GC Available: ${global.gc ? 'YES' : 'NO (run with --expose-gc)'}`);
  
  // Show initial memory
  console.log('\n📊 INITIAL MEMORY STATUS:');
  checkMemoryStatus();
  
  console.log('\n========================================');
  
  // Start all services
  startKeepAlive();
  startCleanupScheduler();
  startMemoryMonitoring();
  
  console.log('\n✅ All systems operational');
  console.log('========================================\n');
});