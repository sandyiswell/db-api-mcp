import fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import Database from "better-sqlite3";

// -------------------------
// Ensure DB directory exists
// -------------------------
fs.mkdirSync("C:/claude_db", { recursive: true });

// -------------------------
// Setup SQLite database
// -------------------------
const db = new Database("C:/claude_db/weather.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS weather_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city TEXT NOT NULL,
    temperature TEXT,
    condition TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// -------------------------
// MCP Server
// -------------------------
const server = new Server(
  {
    name: "db-api-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// -------------------------
// List Tools
// -------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_weather",
        description: "Fetches live weather for a city",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
      {
        name: "save_weather",
        description: "Saves weather data to database",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
            temperature: { type: "string" },
            condition: { type: "string" },
          },
          required: ["city", "temperature", "condition"],
        },
      },
      {
        name: "get_weather_history",
        description: "Fetch weather history from database",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
        },
      },
      {
        name: "clear_weather_history",
        description: "Clear all weather history",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// -------------------------
// Tool Handler
// -------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // -------------------------
    // Tool 1: Get Weather
    // -------------------------
    if (name === "get_weather") {
      const city = String(args.city);

      const response = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1`
      );

      const data = await response.json();

      const temp = data.current_condition[0].temp_C;
      const condition = data.current_condition[0].weatherDesc[0].value;
      const feelsLike = data.current_condition[0].FeelsLikeC;
      const humidity = data.current_condition[0].humidity;

      return {
        content: [
          {
            type: "text",
            text:
              `Weather in ${city}:\n` +
              `Temperature: ${temp}°C (Feels like ${feelsLike}°C)\n` +
              `Condition: ${condition}\n` +
              `Humidity: ${humidity}%`,
          },
        ],
      };
    }

    // -------------------------
    // Tool 2: Save Weather
    // -------------------------
    if (name === "save_weather") {
      const city = String(args.city);
      const temperature = String(args.temperature);
      const condition = String(args.condition);

      const stmt = db.prepare(`
        INSERT INTO weather_log (city, temperature, condition)
        VALUES (?, ?, ?)
      `);

      stmt.run(city, temperature, condition);

      return {
        content: [
          {
            type: "text",
            text: `Saved weather for ${city}`,
          },
        ],
      };
    }

    // -------------------------
    // Tool 3: Get History
    // -------------------------
    if (name === "get_weather_history") {
      const city = args?.city ? String(args.city) : null;

      let rows;

      if (city) {
        rows = db
          .prepare(
            `
            SELECT * FROM weather_log
            WHERE city LIKE ?
            ORDER BY fetched_at DESC
          `
          )
          .all(`%${city}%`);
      } else {
        rows = db
          .prepare(
            `
            SELECT * FROM weather_log
            ORDER BY fetched_at DESC
          `
          )
          .all();
      }

      if (rows.length === 0) {
        return {
          content: [{ type: "text", text: "No records found." }],
        };
      }

      const result = rows
        .map(
          (r) =>
            `${r.city} | ${r.temperature} | ${r.condition} | ${r.fetched_at}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    }

    // -------------------------
    // Tool 4: Clear History
    // -------------------------
    if (name === "clear_weather_history") {
      db.exec("DELETE FROM weather_log");

      return {
        content: [
          {
            type: "text",
            text: "Weather history cleared.",
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err.message}`,
        },
      ],
    };
  }
});

// -------------------------
// Start MCP Server
// -------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("db-api-mcp server running...");
}

main().catch((err) => {
  console.error("Fatal error:", err);
});