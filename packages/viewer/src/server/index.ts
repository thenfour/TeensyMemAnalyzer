import express, { type Request, type Response } from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createRequire } from 'module';
import type { AnalyzeBuildParams, Analysis } from '@teensy-mem-explorer/analyzer';
import type { AnalysisBroadcastPayload, ServerConfig, ServerMessage, ServerStatusPayload } from '../shared/protocol';

const require = createRequire(import.meta.url);
const { analyzeBuild } = require('@teensy-mem-explorer/analyzer') as typeof import('@teensy-mem-explorer/analyzer');

const DEFAULT_PORT = Number.parseInt(process.env.TME_VIEWER_PORT ?? '5317', 10);
const VERSION = '0.1.0-dev';

const app = express();
app.use(express.json());

let currentStatus: ServerStatusPayload = { state: 'idle' };
let activeConfig: ServerConfig = {
  debounceMs: 1500,
  autoRun: true,
  targetId: "teensy40",
    elfPath: "C:\\root\\git\\thenfour\\Clarinoid\\projects\\CLARINOID2\\.pio\\build\\teensy\\firmware.elf",
    mapPath: "C:\\root\\git\\thenfour\\Clarinoid\\projects\\CLARINOID2\\.pio\\build\\teensy\\firmware.map",
    toolchainDir: "C:\\Users\\carl\\.platformio\\packages\\toolchain-gccarmnoneeabi-teensy\\bin",
    toolchainPrefix: "arm-none-eabi-",
};
let lastAnalysis: Analysis | null = null;
let lastAnalysisGeneratedAt: string | null = null;

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sockets = new Set<WebSocket>();

const broadcastStatus = (): void => {
  const message: ServerMessage = { type: 'status', payload: currentStatus };
  const encoded = JSON.stringify(message);
  sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encoded);
    }
  });
};

const broadcastConfig = (): void => {
  const message: ServerMessage = { type: 'config', payload: activeConfig };
  const encoded = JSON.stringify(message);
  sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encoded);
    }
  });
};

const broadcastAnalysis = (): void => {
  if (!lastAnalysis || !lastAnalysisGeneratedAt) {
    return;
  }

  const payload: AnalysisBroadcastPayload = {
    analysis: lastAnalysis,
    generatedAt: lastAnalysisGeneratedAt,
  };
  const message: ServerMessage = { type: 'analysis', payload };
  const encoded = JSON.stringify(message);
  sockets.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encoded);
    }
  });
};

wss.on('connection', (socket) => {
  sockets.add(socket);

  const hello: ServerMessage = { type: 'hello', payload: { message: 'viewer connected' } };
  socket.send(JSON.stringify(hello));
  socket.send(JSON.stringify({ type: 'status', payload: currentStatus } satisfies ServerMessage));
  socket.send(JSON.stringify({ type: 'config', payload: activeConfig } satisfies ServerMessage));
  if (lastAnalysis && lastAnalysisGeneratedAt) {
    socket.send(
      JSON.stringify(
        {
          type: 'analysis',
          payload: { analysis: lastAnalysis, generatedAt: lastAnalysisGeneratedAt },
        } satisfies ServerMessage,
      ),
    );
  }

  socket.on('close', () => {
    sockets.delete(socket);
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: VERSION,
    port: DEFAULT_PORT,
    state: currentStatus,
    latestAnalysisGeneratedAt: lastAnalysisGeneratedAt ?? undefined,
  });
});

app.get('/api/config', (_req: Request, res: Response) => {
  res.json({ config: activeConfig });
});

app.put('/api/config', (req: Request, res: Response) => {
  const updates = req.body as Partial<ServerConfig> | undefined;
  if (!updates) {
    res.status(400).json({ error: 'Missing config payload.' });
    return;
  }

  activeConfig = {
    ...activeConfig,
    ...updates,
  };

  res.json({ config: activeConfig });
  broadcastConfig();
});

app.post('/api/run', async (_req: Request, res: Response) => {
  if (!activeConfig.targetId || !activeConfig.elfPath) {
    res.status(400).json({ error: 'Configuration must specify targetId and elfPath before running analysis.' });
    return;
  }

  const startTime = new Date().toISOString();
  currentStatus = {
    state: 'running',
    lastRunStartedAt: startTime,
  };
  broadcastStatus();

  const params: AnalyzeBuildParams = {
    targetId: activeConfig.targetId,
    elfPath: activeConfig.elfPath,
    mapPath: activeConfig.mapPath,
    toolchainDir: activeConfig.toolchainDir,
    toolchainPrefix: activeConfig.toolchainPrefix,
  };

  try {
    const analysis = await analyzeBuild(params);
    lastAnalysis = analysis;
    lastAnalysisGeneratedAt = new Date().toISOString();

    currentStatus = {
      state: activeConfig.autoRun ? 'watching' : 'idle',
      lastRunStartedAt: startTime,
      lastRunCompletedAt: lastAnalysisGeneratedAt,
    };
    broadcastStatus();
    broadcastAnalysis();

    res.status(200).json({ status: 'ok', generatedAt: lastAnalysisGeneratedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown analysis failure.';
    currentStatus = {
      state: 'error',
      lastRunStartedAt: startTime,
      errorMessage: message,
    };
    broadcastStatus();
    res.status(500).json({ error: message });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

const port = DEFAULT_PORT;

server.listen(port, () => {
  console.log(`[viewer-server] Listening on http://localhost:${port}`);
});

const shutdown = (): void => {
  console.log('[viewer-server] Shutting down');
  sockets.forEach((socket) => socket.close());
  wss.close();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
