import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "weekly-report-os-sc360-admin-"));
const dbPath = path.join(tempDir, "weekly-report-os.sqlite");

try {
  const owner = await startServer({ userId: "mock_owner", name: "Owner" });
  try {
    await postJson(owner.baseUrl, "/api/employees/manage", {
      userId: "admin-open", name: "Joy Admin", department: "人力行政部",
    });
    await postJson(owner.baseUrl, "/api/scoring360-admin-members", {
      members: [{ userId: "admin-open", name: "Joy Admin", department: "人力行政部" }],
    });

    await postJson(owner.baseUrl, "/api/employees/manage", {
      userId: "mock_owner",
      name: "Owner",
      department: "管理层",
      email: "owner@example.invalid",
    });
    await postJson(owner.baseUrl, "/api/employees/manage", {
      userId: "employee-open",
      name: "Employee A",
      department: "测试部",
      email: "employee-a@example.invalid",
    });
    await postJson(owner.baseUrl, "/api/employees/manage", {
      userId: "evaluator-open",
      name: "Evaluator B",
      department: "测试部",
      email: "evaluator-b@example.invalid",
    });

    const configBefore = await fetchJson(owner.baseUrl, "/api/scoring360/config");
    assert(configBefore.employees.some((employee) => employee.userId === "employee-open"), "active employee should be configurable");

    await postJson(owner.baseUrl, "/api/scoring360/assignments", {
      cycleId: configBefore.cycle.id,
      evalueeName: "Employee A",
      evaluatorName: "Evaluator B",
    });

    const historicalAssignment = await postJson(owner.baseUrl, "/api/scoring360/assignments", {
      cycleId: configBefore.cycle.id,
      evalueeName: "Employee A",
      evaluatorName: "Owner",
    });
    await postJson(owner.baseUrl, "/api/scoring360/submit", {
      cycleId: configBefore.cycle.id,
      scores: [{ assignmentId: historicalAssignment.assignment.id, score: 92, comment: "历史评分需要保留" }],
    });
    await deleteJson(owner.baseUrl, "/api/scoring360/assignments", {
      assignmentId: historicalAssignment.assignment.id,
    });
    const overviewAfterDelete = await fetchJson(owner.baseUrl, "/api/scoring360");
    const retained = overviewAfterDelete.results.find((item) => item.name === "Employee A");
    assert(retained?.submitted === 1, "removing a relationship must preserve submitted scoring history");


    await postJson(owner.baseUrl, "/api/employees/manage/status", {
      userId: "employee-open",
      active: false,
    });

    const configAfter = await fetchJson(owner.baseUrl, "/api/scoring360/config");
    assert(!configAfter.employees.some((employee) => employee.userId === "employee-open"), "inactive employee must leave current scoring candidates");
    const inactiveCreate = await requestJson(owner.baseUrl, "/api/scoring360/assignments", {
      method: "POST",
      body: {
        cycleId: configAfter.cycle.id,
        evalueeName: "Employee A",
        evaluatorName: "Evaluator B",
      },
    });
    assert(inactiveCreate.status === 409, `inactive assignment should be rejected, got ${inactiveCreate.status}`);
    const reminders = await fetchJson(owner.baseUrl, "/api/scoring360/reminders");
    assert(!reminders.pending.some((item) => item.pendingNames.includes("Employee A")), "inactive employee must leave reminder pending lists");
    const invalidEmployee=await requestJson(owner.baseUrl,"/api/employees/manage",{method:"POST",body:{name:"",userId:""}});
    assert(invalidEmployee.status===400,"blank employee form must return a validation error");
    await postJson(owner.baseUrl,"/api/employees/manage",{userId:"employee-open",name:"Employee A",department:"测试部"});
    const restored=await fetchJson(owner.baseUrl,"/api/employees/manage");
    assert(restored.employees.filter(e=>e.userId==="employee-open").length===1,"restore should not duplicate employee");
    assert(restored.employees.find(e=>e.userId==="employee-open").active===true,"upsert should restore inactive employee");
  } finally {
    await owner.stop();
  }

  const admin = await startServer({ userId: "admin-open", name: "Joy Admin" });
  try {
    const me = await fetchJson(admin.baseUrl, "/api/me");
    assert(me.access?.bossView === true, "administrator shares boss management capabilities");
    assert(me.access?.canManageScoring360 === true, "configured scoring admin should manage scoring360");
    assert(me.access?.canManagePersonnel === true, "configured scoring admin should manage personnel");
    await fetchJson(admin.baseUrl, "/api/employees/manage");
    assert((await requestJson(admin.baseUrl,"/api/boss-view-members")).status===200,"administrator shares role management capabilities");
    assert(me.access?.role === "system_admin", "administrator has separate role");
  } finally {
    await admin.stop();
  }

  const member = await startServer({ userId: "member-open", name: "普通同事" });
  try {
    const response = await requestJson(member.baseUrl, "/api/employees/manage");
    assert(response.status === 403, `ordinary member should be forbidden, got ${response.status}`);
  } finally {
    await member.stop();
  }

  console.log("scoring360 admin api test passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function startServer(user) {
  const port = 6300 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env, APP_DATA_DIR: "src/data",
      AUTH_MODE: "mock",
      SERVER_PORT: String(port),
      BASE_URL: baseUrl,
      WEEKLY_REPORT_DB_PATH: dbPath,
      SCORING360_ACTIVE_DATE: "2026-06-24T10:00:00+08:00",
      MOCK_USER_ID: user.userId,
      MOCK_USER_NAME: user.name,
      MOCK_USER_EMAIL: `${user.userId}@example.invalid`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  await waitForHealth(baseUrl, child, () => ({ stdout, stderr }));
  return {
    baseUrl,
    async stop() {
      child.kill("SIGTERM");
      if (child.exitCode === null) {
        await new Promise((resolve) => {
          child.once("exit", resolve);
          setTimeout(resolve, 2000);
        });
      }
    },
  };
}

async function waitForHealth(baseUrl, child, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const output = logs();
      throw new Error(`server exited early code=${child.exitCode}\nstdout=${output.stdout}\nstderr=${output.stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Retry until the server starts listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not become healthy: ${JSON.stringify(logs())}`);
}

async function fetchJson(baseUrl, pathname) {
  const response = await requestJson(baseUrl, pathname);
  if (!response.ok || response.json?.ok === false) {
    throw new Error(`request failed ${pathname}: ${response.status} ${response.text}`);
  }
  return response.json;
}

async function postJson(baseUrl, pathname, body) {
  const response = await requestJson(baseUrl, pathname, { method: "POST", body });
  if (!response.ok || response.json?.ok === false) {
    throw new Error(`request failed ${pathname}: ${response.status} ${response.text}`);
  }
  return response.json;
}

async function deleteJson(baseUrl, pathname, body) {
  const response = await requestJson(baseUrl, pathname, { method: "DELETE", body });
  if (!response.ok || response.json?.ok === false) {
    throw new Error(`request failed ${pathname}: ${response.status} ${response.text}`);
  }
  return response.json;
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // The caller can inspect the raw response.
  }
  return { ok: response.ok, status: response.status, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
