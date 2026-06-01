import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import fetch from "node-fetch";
import Database from "better-sqlite3";

// Setup SQLite database
const db = new Database("C:/claude_db/weather.db");

// Create table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS weather_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    city TEXT NOT NULL,
    temperature TEXT,
    condition TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create MCP Server
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

// Define Tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_weather",
      description: "Fetches live weather for a city from the internet",
      inputSchema: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Name of the city",
          },
        },
        required: ["city"],
      },
    },
    {
      name: "save_weather",
      description: "Saves weather data for a city into the database",
      inputSchema: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "City name",
          },
          temperature: {
            type: "string",
            description: "Temperature",
          },
          condition: {
            type: "string",
            description: "Weather condition",
          },
        },
        required: ["city", "temperature", "condition"],
      },
    },
    {
      name: "get_weather_history",
      description: "Gets all saved weather records from the database",
      inputSchema: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Optional city filter",
          },
        },
        required: [],
      },
    },
    {
      name: "clear_weather_history",
      description: "Clears all weather records from the database",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
}));

// Handle Tool Calls
server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    // Tool 1 - Fetch live weather from API
    if (name === "get_weather") {
      const city = String(args?.city);

      const response = await fetch(
        `https://wttr.in/${encodeURIComponent(city)}?format=j1`
      );

      const data: any = await response.json();

      const temp = data.current_condition[0].temp_C;
      const condition =
        data.current_condition[0].weatherDesc[0].value;
      const feelsLike =
        data.current_condition[0].FeelsLikeC;
      const humidity =
        data.current_condition[0].humidity;

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

    // Tool 2 - Save weather data to database
    if (name === "save_weather") {
      const city = String(args?.city);
      const temperature = String(args?.temperature);
      const condition = String(args?.condition);

      const stmt = db.prepare(
        `INSERT INTO weather_log (city, temperature, condition)
         VALUES (?, ?, ?)`
      );

      stmt.run(city, temperature, condition);

      return {
        content: [
          {
            type: "text",
            text: `Weather data for ${city} saved to database successfully`,
          },
        ],
      };
    }

    // Tool 3 - Get weather history from database
    if (name === "get_weather_history") {
      const city = args?.city ? String(args.city) : null;

      let rows: any[];

      if (city) {
        rows = db
          .prepare(
            `SELECT * FROM weather_log
             WHERE city LIKE ?
             ORDER BY fetched_at DESC`
          )
          .all(`%${city}%`);
      } else {
        rows = db
          .prepare(
            `SELECT * FROM weather_log
             ORDER BY fetched_at DESC`
          )
          .all();
      }

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No weather records found in database.",
            },
          ],
        };
      }

      const result = rows
        .map(
          (row) =>
            `${row.city} | ${row.temperature} | ${row.condition} | ${row.fetched_at}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Weather History:\n\n${result}`,
          },
        ],
      };
    }

    // Tool 4 - Clear database
    if (name === "clear_weather_history") {
      db.exec("DELETE FROM weather_log");

      return {
        content: [
          {
            type: "text",
            text: "All weather records cleared from database.",
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  }
);

// Start Server
async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error("DB + API MCP Server running!");
}

main().catch(console.error);