import { NextResponse } from 'next/server';
import os from 'os';

// Track server start time
const serverStartTime = Date.now();

// GET /api/health/app - Application health check
export async function GET() {
  try {
    const uptimeMs = Date.now() - serverStartTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    
    // Format uptime string
    let uptimeString = '';
    if (uptimeDays > 0) {
      uptimeString = `${uptimeDays}d ${uptimeHours % 24}h`;
    } else if (uptimeHours > 0) {
      uptimeString = `${uptimeHours}h ${uptimeMinutes % 60}m`;
    } else if (uptimeMinutes > 0) {
      uptimeString = `${uptimeMinutes}m ${uptimeSeconds % 60}s`;
    } else {
      uptimeString = `${uptimeSeconds}s`;
    }
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: uptimeString,
      uptimeMs,
      node: {
        version: process.version,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB'
        }
      },
      system: {
        platform: os.platform(),
        release: os.release(),
        totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024),
        memoryUnit: 'GB',
        cpuCount: os.cpus().length,
        loadAverage: os.loadavg()
      }
    };
    
    return NextResponse.json(health, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      { 
        status: 'error',
        message: 'Health check failed',
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}