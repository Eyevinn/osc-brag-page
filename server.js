const Fastify = require("fastify");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, "data", "metrics.json");

function loadMetrics() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return getDefaultMetrics();
  }
}

function saveMetrics(metrics) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(metrics, null, 2));
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

async function build() {
  const app = Fastify({ logger: true });

  await app.register(require("@fastify/cors"), { origin: true });
  await app.register(require("@fastify/static"), {
    root: path.join(__dirname, "public"),
    prefix: "/",
  });

  // Initialize data file if missing
  if (!fs.existsSync(DATA_FILE)) {
    saveMetrics(getDefaultMetrics());
  }

  // API: Get metrics
  app.get("/api/metrics", async () => {
    return loadMetrics();
  });

  // API: Update metrics (MCP-compatible)
  app.put("/api/metrics", async (request) => {
    const current = loadMetrics();
    const updates = request.body;
    const merged = deepMerge(current, updates);
    merged.lastUpdated = new Date().toISOString().split("T")[0];
    saveMetrics(merged);
    return { ok: true, lastUpdated: merged.lastUpdated };
  });

  // API: Update a specific section
  app.patch("/api/metrics/:section", async (request) => {
    const { section } = request.params;
    const current = loadMetrics();
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

  // API: Add a milestone
  app.post("/api/metrics/milestones", async (request) => {
    const current = loadMetrics();
    current.milestones.push(request.body);
    current.lastUpdated = new Date().toISOString().split("T")[0];
    saveMetrics(current);
    return { ok: true, milestones: current.milestones.length };
  });

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  await app.listen({ port: parseInt(PORT), host: "0.0.0.0" });
  return app;
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

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
