const Fastify = require("fastify");
const path = require("path");
const fs = require("fs");
const Redis = require("ioredis");
const { Resvg } = require("@resvg/resvg-js");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const PORT = process.env.PORT || 8080;
const VALKEY_URL = process.env.VALKEY_URL;
const METRICS_KEY = "brag:metrics";

// ---------------------------------------------------------------------------
// Metrics persistence (Valkey-backed with in-memory cache)
// ---------------------------------------------------------------------------

let redis = null;
let metricsCache = null;

function initRedis() {
  if (!VALKEY_URL) {
    console.log("No VALKEY_URL set - using in-memory storage only (data lost on restart)");
    return;
  }
  redis = new Redis(VALKEY_URL, {
    retryStrategy: (times) => Math.min(times * 200, 5000),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  redis.on("error", (err) => console.error("Valkey error:", err.message));
  redis.on("connect", () => console.log("Connected to Valkey"));
}

async function loadMetrics() {
  // Return cache if available
  if (metricsCache) return metricsCache;

  // Try Valkey
  if (redis) {
    try {
      const data = await redis.get(METRICS_KEY);
      if (data) {
        metricsCache = JSON.parse(data);
        return metricsCache;
      }
    } catch (err) {
      console.error("Valkey read error:", err.message);
    }
  }

  // Fall back to defaults and seed Valkey
  metricsCache = getDefaultMetrics();
  await saveMetrics(metricsCache);
  return metricsCache;
}

async function saveMetrics(metrics) {
  metricsCache = metrics;
  if (redis) {
    try {
      await redis.set(METRICS_KEY, JSON.stringify(metrics));
    } catch (err) {
      console.error("Valkey write error:", err.message);
    }
  }
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

function getDefaultMetrics() {
  return {
    lastUpdated: "2026-02-24",
    period: "Last 90 days",
    headline: {
      aiAutonomyPercent: 92,
      totalCommits90d: 930,
      totalRepos: 15,
      totalPRs90d: 620,
      productionDeploys90d: 178,
    },
    teams: {
      aiDevTeam: {
        label: "AI Dev & Ops Team",
        description:
          "Claude Code agents orchestrated by a human team lead. Handles architecture, implementation, testing, deployment, and 24/7 operations.",
        commits90d: 685,
        commitsAllTime: 3038,
        prs90d: 305,
        avatar: "robot",
        members: [
          "Architect Agent",
          "Backend Developer",
          "Frontend Developer",
          "UX Designer",
          "Tester",
          "Technical Writer",
        ],
      },
      aiAgentDirect: {
        label: "Autonomous AI Agents",
        description:
          "claude[bot] and dependabot[bot] operating fully autonomously - creating PRs, merging dependency updates, and shipping features without human intervention.",
        commits90d: 154,
        commitsAllTime: 154,
        prs90d: 220,
        avatar: "bot",
        members: [
          "claude[bot] - Feature PRs",
          "dependabot[bot] - Dependency Updates",
          "Auto-merge Pipeline",
          "Daily Deploy Pipeline",
        ],
      },
      pmTeam: {
        label: "PM / Business Team",
        description:
          "Alexander Bjorneheim drives product strategy, creates issues, reviews PRs, and validates features. The human product vision behind the AI execution.",
        commits90d: 14,
        commitsAllTime: 14,
        prs90d: 46,
        avatar: "user",
      },
      humanContributors: {
        label: "Human Contributors",
        description:
          "Open source contributors and team members working alongside AI agents on frontend and testing.",
        commits90d: 76,
        commitsAllTime: 1024,
        prs90d: 28,
        avatar: "users",
      },
    },
    repos: [
      { name: "osaas-app", desc: "Main web application (Next.js)", ai: 245, human: 77 },
      { name: "osaas-landing-app", desc: "Landing page / marketing site", ai: 131, human: 3 },
      { name: "osaas-ai", desc: "AI manager, MCP, OSC Architect", ai: 99, human: 0 },
      { name: "osaas-service-builder", desc: "AI builder agent", ai: 80, human: 0 },
      { name: "osaas-deploy-manager", desc: "Deployment orchestration", ai: 71, human: 0 },
      { name: "osaas-catalog-manager", desc: "Service catalog", ai: 36, human: 17 },
      { name: "osaas-maker-manager", desc: "Maker pipeline", ai: 24, human: 17 },
      { name: "osaas-maker", desc: "Build & containerize", ai: 40, human: 0 },
      { name: "osaas-e2e-tests", desc: "End-to-end tests", ai: 16, human: 8 },
      { name: "osaas-money-manager", desc: "Billing & subscriptions", ai: 22, human: 0 },
      { name: "osaas-lib-orchestrator", desc: "Orchestrator library", ai: 13, human: 0 },
      { name: "osaas-token-service", desc: "Auth & tokens", ai: 3, human: 0 },
    ],
    automation: {
      dailyDeploy: {
        label: "Daily Production Deploy",
        desc: "Scheduled script checks all repos for undeployed commits and auto-deploys to production following SOPs.",
        frequency: "Daily at 11:00",
      },
      focusWork: {
        label: "AI Focus Work Sessions",
        desc: "Claude agents are spawned to implement fixes for planned issues - branch, code, test, PR - fully autonomously.",
        frequency: "Daily at 08:00",
      },
      dependabotMerge: {
        label: "Dependabot Auto-Merge",
        desc: "Scans all 15 repos for dependency update PRs. Merges safe patches, closes broken ones, flags majors for review.",
        frequency: "Daily at 09:00",
      },
      healthCheck: {
        label: "Platform Health Monitoring",
        desc: "Queries Prometheus via Grafana API, checks pod health, certificate expiry, and resource usage across all clusters.",
        frequency: "Every 4 hours",
      },
    },
    milestones: [
      { date: "2025-12", event: "AI Dev Team formed with Claude Code agents" },
      { date: "2026-01", event: "First fully autonomous PR merged to production" },
      { date: "2026-01", event: "Daily automated production deploy pipeline launched" },
      { date: "2026-02", event: "AI agents managing 15+ microservices across 3 clusters" },
      { date: "2026-02", event: "92% of commits now AI-authored" },
    ],
  };
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

function createMcpServer() {
  const mcp = new McpServer({
    name: "osc-brag-page",
    version: "1.0.0",
  });

  // Tool: get metrics
  mcp.tool(
    "get-metrics",
    "Get all current metrics from the OSC AI Autonomy Brag Page",
    {},
    async () => {
      const metrics = await loadMetrics();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(metrics, null, 2),
          },
        ],
      };
    }
  );

  // Tool: update headline stats
  mcp.tool(
    "update-headline",
    "Update the headline stats shown at the top of the brag page",
    {
      aiAutonomyPercent: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("AI autonomy percentage"),
      totalCommits90d: z
        .number()
        .optional()
        .describe("Total commits in last 90 days"),
      totalRepos: z.number().optional().describe("Total repositories"),
      totalPRs90d: z
        .number()
        .optional()
        .describe("Total PRs in last 90 days"),
      productionDeploys90d: z
        .number()
        .optional()
        .describe("Total production deploys in last 90 days"),
    },
    async (args) => {
      const current = await loadMetrics();
      const update = {};
      if (args.aiAutonomyPercent !== undefined)
        update.aiAutonomyPercent = args.aiAutonomyPercent;
      if (args.totalCommits90d !== undefined)
        update.totalCommits90d = args.totalCommits90d;
      if (args.totalRepos !== undefined) update.totalRepos = args.totalRepos;
      if (args.totalPRs90d !== undefined)
        update.totalPRs90d = args.totalPRs90d;
      if (args.productionDeploys90d !== undefined)
        update.productionDeploys90d = args.productionDeploys90d;

      current.headline = { ...current.headline, ...update };
      current.lastUpdated = new Date().toISOString().split("T")[0];
      await saveMetrics(current);
      return {
        content: [
          {
            type: "text",
            text: `Headline updated: ${JSON.stringify(current.headline)}`,
          },
        ],
      };
    }
  );

  // Tool: update team stats
  mcp.tool(
    "update-team",
    "Update commit/PR stats for a specific team on the brag page",
    {
      team: z
        .enum(["aiDevTeam", "aiAgentDirect", "pmTeam", "humanContributors"])
        .describe("Team identifier"),
      commits90d: z.number().optional().describe("Commits in last 90 days"),
      commitsAllTime: z.number().optional().describe("All-time commit count"),
      prs90d: z.number().optional().describe("PRs in last 90 days"),
    },
    async (args) => {
      const current = await loadMetrics();
      const team = current.teams[args.team];
      if (!team) {
        return {
          content: [{ type: "text", text: `Unknown team: ${args.team}` }],
          isError: true,
        };
      }
      if (args.commits90d !== undefined) team.commits90d = args.commits90d;
      if (args.commitsAllTime !== undefined)
        team.commitsAllTime = args.commitsAllTime;
      if (args.prs90d !== undefined) team.prs90d = args.prs90d;
      current.lastUpdated = new Date().toISOString().split("T")[0];
      await saveMetrics(current);
      return {
        content: [
          {
            type: "text",
            text: `Team "${team.label}" updated: ${team.commits90d} commits, ${team.prs90d} PRs (90d), ${team.commitsAllTime} all-time`,
          },
        ],
      };
    }
  );

  // Tool: update repo stats
  mcp.tool(
    "update-repo",
    "Update the AI vs human commit counts for a repository",
    {
      name: z.string().describe("Repository name (e.g. osaas-app)"),
      desc: z.string().optional().describe("Repository description"),
      ai: z.number().optional().describe("AI-authored commits (90d)"),
      human: z.number().optional().describe("Human commits (90d)"),
    },
    async (args) => {
      const current = await loadMetrics();
      const idx = current.repos.findIndex((r) => r.name === args.name);
      if (idx >= 0) {
        if (args.ai !== undefined) current.repos[idx].ai = args.ai;
        if (args.human !== undefined) current.repos[idx].human = args.human;
        if (args.desc !== undefined) current.repos[idx].desc = args.desc;
      } else {
        current.repos.push({
          name: args.name,
          desc: args.desc || "",
          ai: args.ai || 0,
          human: args.human || 0,
        });
      }
      current.lastUpdated = new Date().toISOString().split("T")[0];
      await saveMetrics(current);
      const repo = current.repos.find((r) => r.name === args.name);
      return {
        content: [
          {
            type: "text",
            text: `Repo "${args.name}" updated: ${repo.ai} AI / ${repo.human} human commits`,
          },
        ],
      };
    }
  );

  // Tool: add milestone
  mcp.tool(
    "add-milestone",
    "Add a new milestone to the brag page timeline",
    {
      date: z
        .string()
        .describe('Milestone date (e.g. "2026-03" or "2026-03-15")'),
      event: z.string().describe("Description of the milestone"),
    },
    async (args) => {
      const current = await loadMetrics();
      current.milestones.push({ date: args.date, event: args.event });
      current.lastUpdated = new Date().toISOString().split("T")[0];
      await saveMetrics(current);
      return {
        content: [
          {
            type: "text",
            text: `Milestone added (${current.milestones.length} total): ${args.date} - ${args.event}`,
          },
        ],
      };
    }
  );

  // Tool: set milestones (replace all)
  mcp.tool(
    "set-milestones",
    "Replace all milestones on the brag page timeline with a new array. Use this for dynamically computed milestones.",
    {
      milestones: z
        .string()
        .describe(
          'JSON array of milestone objects, each with "date" and "event" fields'
        ),
    },
    async (args) => {
      try {
        const milestones = JSON.parse(args.milestones);
        if (!Array.isArray(milestones)) {
          return {
            content: [
              { type: "text", text: "milestones must be a JSON array" },
            ],
            isError: true,
          };
        }
        const current = await loadMetrics();
        current.milestones = milestones;
        current.lastUpdated = new Date().toISOString().split("T")[0];
        await saveMetrics(current);
        return {
          content: [
            {
              type: "text",
              text: `Milestones replaced: ${milestones.length} milestones set`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Invalid JSON: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: bulk update all metrics
  mcp.tool(
    "bulk-update",
    "Replace all metrics at once with a full metrics JSON object. Use get-metrics first to see the current structure.",
    {
      metrics: z
        .string()
        .describe(
          "Full metrics JSON string (must match the metrics schema from get-metrics)"
        ),
    },
    async (args) => {
      try {
        const newMetrics = JSON.parse(args.metrics);
        newMetrics.lastUpdated = new Date().toISOString().split("T")[0];
        await saveMetrics(newMetrics);
        return {
          content: [
            {
              type: "text",
              text: `All metrics replaced. ${newMetrics.repos?.length || 0} repos, ${newMetrics.milestones?.length || 0} milestones. Updated: ${newMetrics.lastUpdated}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Invalid JSON: ${err.message}` },
          ],
          isError: true,
        };
      }
    }
  );

  return mcp;
}

// ---------------------------------------------------------------------------
// OG metadata helpers
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PUBLIC_URL || "https://brag.apps.osaas.io";
const htmlTemplate = fs.readFileSync(
  path.join(__dirname, "public", "index.html"),
  "utf-8"
);

function buildOgTags(metrics) {
  const h = metrics.headline;
  const title = `${h.aiAutonomyPercent}% AI-Authored Code | Eyevinn Open Source Cloud`;
  const description = `${h.totalCommits90d.toLocaleString()} commits, ${h.totalPRs90d.toLocaleString()} PRs, ${(h.productionDeploys90d || 0).toLocaleString()} production deploys in 90 days — built by autonomous AI agents across ${h.totalRepos} repos.`;
  const imageUrl = `${BASE_URL}/og-image.png`;

  return [
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${imageUrl}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:url" content="${BASE_URL}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${imageUrl}" />`,
  ].join("\n  ");
}

function injectOgTags(html, metrics) {
  const tags = buildOgTags(metrics);
  // Also update <title> and <meta name="description"> with live values
  const h = metrics.headline;
  const title = `${h.aiAutonomyPercent}% AI-Authored Code | Eyevinn Open Source Cloud`;
  const description = `${h.totalCommits90d.toLocaleString()} commits, ${h.totalPRs90d.toLocaleString()} PRs, ${(h.productionDeploys90d || 0).toLocaleString()} production deploys in 90 days — built by autonomous AI agents across ${h.totalRepos} repos.`;

  let result = html.replace(
    /<title>.*?<\/title>/,
    `<title>${title}</title>`
  );
  result = result.replace(
    /<meta name="description" content=".*?" \/>/,
    `<meta name="description" content="${description}" />`
  );
  // Inject OG tags right after the description meta tag
  result = result.replace(
    /(<meta name="description" content="[^"]*" \/>)/,
    `$1\n  ${tags}`
  );
  return result;
}

// ---------------------------------------------------------------------------
// OG image generation
// ---------------------------------------------------------------------------

let ogImageCache = null;
let ogImageCacheTime = 0;
const OG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function buildOgSvg(metrics) {
  const h = metrics.headline;
  const pct = h.aiAutonomyPercent;
  const commits = h.totalCommits90d.toLocaleString();
  const prs = h.totalPRs90d.toLocaleString();
  const deploys = (h.productionDeploys90d || 0).toLocaleString();
  const repos = h.totalRepos;

  // Progress bar width (percentage of 400px max)
  const barWidth = Math.round((pct / 100) * 400);

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6c5ce7"/>
      <stop offset="100%" style="stop-color:#a29bfe"/>
    </linearGradient>
    <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#00c853"/>
      <stop offset="100%" style="stop-color:#00e676"/>
    </linearGradient>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#0f0f1a"/>
      <stop offset="100%" style="stop-color:#0a0a0f"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>

  <!-- Subtle grid pattern -->
  <g opacity="0.03">
    ${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="630" stroke="#fff" stroke-width="1"/>`).join("")}
    ${Array.from({ length: 13 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="1200" y2="${i * 50}" stroke="#fff" stroke-width="1"/>`).join("")}
  </g>

  <!-- Top accent line -->
  <rect x="0" y="0" width="1200" height="4" fill="url(#accent)"/>

  <!-- Title -->
  <text x="80" y="100" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="28" font-weight="600" fill="#8888a0" letter-spacing="2">BUILT BY AI AGENTS</text>

  <!-- Hero percentage -->
  <text x="80" y="210" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="120" font-weight="800" fill="#00e676">${pct}%</text>
  <text x="80" y="260" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="32" font-weight="500" fill="#e8e8f0">AI-Authored Code</text>

  <!-- Progress bar background -->
  <rect x="80" y="285" width="400" height="8" rx="4" fill="#1a1a28"/>
  <!-- Progress bar fill -->
  <rect x="80" y="285" width="${barWidth}" height="8" rx="4" fill="url(#greenGrad)"/>

  <!-- Decorative circle on right -->
  <circle cx="950" cy="180" r="140" fill="none" stroke="#6c5ce7" stroke-width="3" opacity="0.15"/>
  <circle cx="950" cy="180" r="100" fill="none" stroke="#6c5ce7" stroke-width="2" opacity="0.1"/>

  <!-- Stats row -->
  <g transform="translate(80, 370)">
    <!-- Commits -->
    <g>
      <rect x="0" y="0" width="220" height="100" rx="12" fill="#12121a" stroke="#2a2a3a" stroke-width="1"/>
      <text x="110" y="45" font-family="Inter, sans-serif" font-size="36" font-weight="700" fill="#e8e8f0" text-anchor="middle">${commits}</text>
      <text x="110" y="75" font-family="Inter, sans-serif" font-size="16" fill="#8888a0" text-anchor="middle">Commits (90d)</text>
    </g>
    <!-- PRs -->
    <g transform="translate(245, 0)">
      <rect x="0" y="0" width="220" height="100" rx="12" fill="#12121a" stroke="#2a2a3a" stroke-width="1"/>
      <text x="110" y="45" font-family="Inter, sans-serif" font-size="36" font-weight="700" fill="#e8e8f0" text-anchor="middle">${prs}</text>
      <text x="110" y="75" font-family="Inter, sans-serif" font-size="16" fill="#8888a0" text-anchor="middle">Pull Requests</text>
    </g>
    <!-- Deploys -->
    <g transform="translate(490, 0)">
      <rect x="0" y="0" width="220" height="100" rx="12" fill="#12121a" stroke="#2a2a3a" stroke-width="1"/>
      <text x="110" y="45" font-family="Inter, sans-serif" font-size="36" font-weight="700" fill="#00e676" text-anchor="middle">${deploys}</text>
      <text x="110" y="75" font-family="Inter, sans-serif" font-size="16" fill="#8888a0" text-anchor="middle">Prod Deploys</text>
    </g>
    <!-- Repos -->
    <g transform="translate(735, 0)">
      <rect x="0" y="0" width="220" height="100" rx="12" fill="#12121a" stroke="#2a2a3a" stroke-width="1"/>
      <text x="110" y="45" font-family="Inter, sans-serif" font-size="36" font-weight="700" fill="#6c5ce7" text-anchor="middle">${repos}</text>
      <text x="110" y="75" font-family="Inter, sans-serif" font-size="16" fill="#8888a0" text-anchor="middle">Repositories</text>
    </g>
  </g>

  <!-- Bottom branding -->
  <text x="80" y="560" font-family="Inter, sans-serif" font-size="22" font-weight="600" fill="#e8e8f0">Eyevinn Open Source Cloud</text>
  <text x="80" y="590" font-family="Inter, sans-serif" font-size="16" fill="#8888a0">brag.apps.osaas.io</text>

  <!-- Bottom accent line -->
  <rect x="0" y="626" width="1200" height="4" fill="url(#accent)"/>
</svg>`;
}

async function renderOgImage(metrics) {
  const now = Date.now();
  if (ogImageCache && now - ogImageCacheTime < OG_CACHE_TTL) {
    return ogImageCache;
  }

  const svg = buildOgSvg(metrics);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });
  const pngData = resvg.render();
  ogImageCache = pngData.asPng();
  ogImageCacheTime = now;
  return ogImageCache;
}

// ---------------------------------------------------------------------------
// Fastify app
// ---------------------------------------------------------------------------

async function build() {
  const app = Fastify({ logger: true });

  await app.register(require("@fastify/cors"), { origin: true });

  // Dynamic index route (injects OG tags) — registered before static plugin
  app.get("/", async (request, reply) => {
    const metrics = await loadMetrics();
    const html = injectOgTags(htmlTemplate, metrics);
    reply.type("text/html").send(html);
  });

  // Dynamic OG image
  app.get("/og-image.png", async (request, reply) => {
    const metrics = await loadMetrics();
    const png = await renderOgImage(metrics);
    reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=300")
      .send(png);
  });

  await app.register(require("@fastify/static"), {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });

  // Initialize Valkey connection and seed defaults if empty
  initRedis();
  if (redis) {
    try {
      await redis.connect();
    } catch (err) {
      console.error("Valkey connect error:", err.message);
    }
  }
  // Pre-load metrics (seeds Valkey with defaults if empty)
  await loadMetrics();

  // ---- REST API ----

  app.get("/api/metrics", async () => await loadMetrics());

  app.put("/api/metrics", async (request) => {
    const current = await loadMetrics();
    const merged = deepMerge(current, request.body);
    merged.lastUpdated = new Date().toISOString().split("T")[0];
    await saveMetrics(merged);
    return { ok: true, lastUpdated: merged.lastUpdated };
  });

  app.patch("/api/metrics/:section", async (request) => {
    const { section } = request.params;
    const current = await loadMetrics();
    if (!current[section]) {
      return { error: `Unknown section: ${section}` };
    }
    current[section] =
      typeof current[section] === "object" && !Array.isArray(current[section])
        ? { ...current[section], ...request.body }
        : request.body;
    current.lastUpdated = new Date().toISOString().split("T")[0];
    saveMetrics(current);
    return { ok: true, section, lastUpdated: current.lastUpdated };
  });

  app.post("/api/metrics/milestones", async (request) => {
    const current = await loadMetrics();
    current.milestones.push(request.body);
    current.lastUpdated = new Date().toISOString().split("T")[0];
    saveMetrics(current);
    return { ok: true, milestones: current.milestones.length };
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  // ---- MCP Streamable HTTP endpoint ----

  // Session map: sessionId -> transport
  const sessions = new Map();

  // Disable Fastify body parsing on /mcp so we can pass raw body to transport
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err);
    }
  });

  async function handleMcpRequest(request, reply) {
    const sessionId = request.headers["mcp-session-id"];

    // Route to existing session
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      return reply.hijack();
    }

    // New session (initialize request)
    const mcp = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await mcp.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);

    // After handling, the transport now has a session ID
    if (transport.sessionId) {
      sessions.set(transport.sessionId, transport);
    }

    return reply.hijack();
  }

  app.post("/mcp", handleMcpRequest);

  app.get("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      return reply.code(400).send({ error: "Invalid or missing session ID" });
    }
    const transport = sessions.get(sessionId);
    await transport.handleRequest(request.raw, reply.raw);
    return reply.hijack();
  });

  app.delete("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      await transport.close();
      sessions.delete(sessionId);
    }
    reply.raw.writeHead(200);
    reply.raw.end();
    return reply.hijack();
  });

  await app.listen({ port: parseInt(PORT), host: "0.0.0.0" });
  return app;
}

const crypto = require("crypto");
build().catch((err) => {
  console.error(err);
  process.exit(1);
});
