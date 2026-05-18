import axios from 'axios';
import type { ProviderWorker } from './types';

export class WorkerClient {
  private worker: ProviderWorker;

  constructor(worker: ProviderWorker) {
    this.worker = worker;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await axios.get(`${this.worker.baseUrl}/health`, { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getEgressIp(): Promise<string | undefined> {
    try {
      const res = await axios.get(`${this.worker.baseUrl}/egress-ip`, { timeout: 10000 });
      return res.data?.ip;
    } catch {
      return undefined;
    }
  }

  async forwardChatCompletion(
    payload: any,
    signal?: AbortSignal,
  ): Promise<{ data: any; headers?: Record<string, string> }> {
    const res = await axios.post(`${this.worker.baseUrl}/v1/chat/completions`, payload, {
      responseType: 'stream',
      timeout: 300000,
      signal,
    });
    return { data: res.data };
  }

  async cancelRun(runId: string): Promise<boolean> {
    try {
      const res = await axios.post(`${this.worker.baseUrl}/runs/${runId}/cancel`, {}, { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
