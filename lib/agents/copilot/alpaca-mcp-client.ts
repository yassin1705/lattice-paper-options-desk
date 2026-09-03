import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

type JsonRecord = Record<string, unknown>;

function environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      ALPACA_PAPER_TRADE: 'true',
      ALPACA_TOOLSETS: 'account,assets,stock-data,options-data,news',
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export class AlpacaMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  async call(toolName: string, args: JsonRecord = {}): Promise<unknown> {
    const client = await this.connect();
    const result = await client.callTool({ name: toolName, arguments: args });
    if (result.isError) {
      const message = result.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join(' ');
      throw new Error(message || `Alpaca MCP tool ${toolName} failed.`);
    }
    const wrapped = result.structuredContent as JsonRecord | undefined;
    return wrapped?.data ?? wrapped ?? result.content;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StdioClientTransport({
        command: process.env.ALPACA_MCP_COMMAND ?? 'uvx',
        args: [process.env.ALPACA_MCP_PACKAGE ?? 'alpaca-mcp-server'],
        env: environment(),
        stderr: 'pipe',
      });
      const client = new Client({
        name: 'alpaca-trading-copilot',
        version: '1.0.0',
      });
      await client.connect(transport);
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
}
