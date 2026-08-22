import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPhotonConfig } from "../src/config.mjs";
import { setupPhoton } from "../src/photon-setup.mjs";

function response(value, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() { return JSON.stringify(value); },
    async json() { return value; },
  };
}

test("provisions a Photon project, user, line, and runtime config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pimess-photon-setup-"));
  const file = join(dir, "photon.json");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options.method || "GET"]);
    if (url.endsWith("/api/auth/device/code")) return response({ device_code: "device", user_code: "ABCD", verification_uri: "https://app.photon.codes/", interval: 0.01 });
    if (url.endsWith("/api/auth/device/token")) return response({ access_token: "dashboard-token" });
    if (url.endsWith("/api/projects") && options.method === "POST") return response({ data: { id: "project-id", name: "PiMess" } });
    if (url.endsWith("/api/projects")) return response({ data: [] });
    if (url.endsWith("/api/projects/project-id/regenerate-secret")) return response({ projectSecret: "project-secret" });
    if (url.endsWith("/projects/project-id/users/") && !options.method) return response({ data: [] });
    if (url.endsWith("/projects/project-id/users/") && options.method === "POST") return response({ data: { id: "user-id", phoneNumber: "+15551234567", assignedPhoneNumber: "+15557654321" } });
    throw new Error(`unexpected request: ${url} ${options.method || "GET"}`);
  };
  try {
    const result = await setupPhoton({ phone: "+15551234567", photonConfigPath: file, openBrowser: false });
    assert.deepEqual(result, { projectId: "project-id", target: "+15551234567", assignedPhone: "+15557654321", created: true });
    assert.deepEqual(loadPhotonConfig(file), {
      projectId: "project-id",
      projectSecret: "project-secret",
      target: "+15551234567",
      dashboardToken: "dashboard-token",
      assignedPhone: "+15557654321",
    });
    assert.equal(calls.length, 7);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
