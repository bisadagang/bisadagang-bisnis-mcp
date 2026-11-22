#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { createServer } from './server.js';

function loadConfig() {
  try {
    return readConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Konfigurasi Bisadagang tidak valid.');
    process.exitCode = 1;
  }
}

const config = loadConfig();
if (config) {
  try {
    await createServer(config).connect(new StdioServerTransport());
  } catch {
    console.error('Server MCP Bisadagang gagal dimulai.');
    process.exitCode = 1;
  }
}
